'use strict';
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path');
const root=process.cwd();
function load(relative){const file=path.join(root,relative),m={exports:{}};new Function('module','exports','require',syncFs.readFileSync(file,'utf8'))(m,m.exports,s=>s.startsWith('.')?JSON.parse(syncFs.readFileSync(path.resolve(path.dirname(file),s),'utf8')):require(s));return m.exports;}
async function jsonFile(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');await fs.rename(file+'.tmp',file);}
async function main(){
 const L=load('scripts/lib.cjs'),P=load('scripts/policy.cjs'),X=load('scripts/extra-sources.cjs'),D=load('scripts/discovery.cjs'),M=load('scripts/media.cjs');
 const output=path.resolve(root,process.env.LIBRARY_FILE||'public/data/library.json'),rawOutput=path.resolve(root,process.env.RAW_LIBRARY_FILE||'storage/index.json');
 const old=await jsonFile(rawOutput,null);if(old&&(old.version!==1||!Array.isArray(old.items)))throw new Error('Invalid previous dataset');
 const poolFile=path.join(root,'storage/source-pool.json'),discoveryFile=path.join(root,'storage/discovery-log.json');
 const agent='DesignShelf/2.0 (public creator resource index; once daily)';
 async function request(url){const u=new URL(url);if(u.protocol!=='https:')throw new Error('HTTPS only');const headers={'User-Agent':agent,'Accept':u.hostname==='api.github.com'?'application/vnd.github+json':'application/json,text/html,image/*,text/plain'};if(u.hostname==='api.github.com'){headers['X-GitHub-Api-Version']='2022-11-28';if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;}return fetch(u,{headers,signal:AbortSignal.timeout(30000)});}
 const previousPool=await jsonFile(poolFile,[]);let discovered;
 if(process.env.DISCOVERY_SKIP==='1')discovered={pool:previousPool,discovery:{...(await jsonFile(discoveryFile,{})),discoverySkipped:true}};
 else discovered=await D.discoverCandidates(request,previousPool,{seedSources:L.SOURCES,maxNew:2});
 await atomic(poolFile,discovered.pool);await atomic(discoveryFile,discovered.discovery);
 const active=[...L.SOURCES,...discovered.pool];const historical=(old?.sources||[]).filter(s=>!active.some(a=>a.id===s.id)).map(s=>({...s,activePool:false}));const allSources=[...active,...historical];
 const chosen=process.env.COLLECT_ALL==='1'?active:D.selectSources(active,{min:4,max:10,newIds:discovered.discovery.newSourceIds||[]});
 const results=[],known=new Set((old?.items||[]).map(x=>L.canonical(x.url)));
 for(const source of chosen){try{
  if(!source.kind.startsWith('github')){const robot=await request(new URL('/robots.txt',source.url));if(robot.ok){const text=await robot.text();if(!L.robotsAllowed(text,source.feed))throw new Error('robots.txt가 목록 경로를 허용하지 않음');}else if(![404,410].includes(robot.status))throw new Error('robots 확인 실패 '+robot.status);await new Promise(r=>setTimeout(r,500));}
  const response=await request(source.feed);if(!response.ok)throw new Error('목록 HTTP '+response.status);
  let items;
  if(source.kind==='json')items=L.promptItems(await response.json());
  else if(source.kind==='github-tree')items=X.githubItems(source,await response.json());
  else if(source.kind==='github-repository')items=X.discoveredRepoItem(source,await response.json());
  else {const text=await response.text();if(source.kind==='filatov')items=X.filatovItems(source,text);else{items=L.threeItems(text);const script=[...text.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(x=>x[1]).find(x=>/^\/assets\/index-[^/]+\.js$/.test(x));if(!script)throw new Error('무료 분류 스크립트 경로 변경');const bundleUrl=new URL(script,source.url).href,bundle=await request(bundleUrl);if(!bundle.ok)throw new Error('무료 분류 확인 실패 '+bundle.status);items=P.classifyThreeUI(items,await bundle.text(),bundleUrl);}}
  const lastCount=old?.sources.find(s=>s.id===source.id)?.itemCount||0;if(lastCount>20&&items.length<lastCount*0.5)throw new Error('목록이 절반 이하로 급감하여 구조 변경으로 처리');
  const parsedCount=items.length;const updates=items.filter(x=>known.has(L.canonical(x.url)));const additions=D.sampleItems(items.filter(x=>!known.has(L.canonical(x.url))),{limit:12});items=[...updates,...additions];
  results.push({id:source.id,ok:true,items,parsedCount});console.log(source.name+': '+items.length+'개 확인 (공개 목록 '+parsedCount+'개)');
 }catch(e){results.push({id:source.id,ok:false,error:e.message});console.error(source.name+': '+e.message);}}
 const cache=await jsonFile(path.join(root,'public/data/ko.json'),{entries:{}});let raw=L.applyTranslations(L.mergeLibrary(old,results,new Date().toISOString(),allSources),cache);
 const failed=new Set(results.filter(x=>!x.ok).map(x=>x.id));raw.items=raw.items.map(x=>failed.has(x.sourceId)?{...x,access:'unknown',pricingEvidence:null}:x);
 const reading=await jsonFile(path.join(root,'public/data/reading-access.json'),{entries:{}});raw=P.applyReadingEvidence(raw,reading);
 const sampled=D.sampleItems(raw.items.filter(x=>x.access==='free'&&chosen.some(s=>s.id===x.sourceId)),{limit:12});
 raw.discovery={...discovered.discovery,mode:process.env.COLLECT_ALL==='1'?'initial-import':'random',seedSourceCount:L.SOURCES.length,totalSourceCount:active.length,selectedSourceIds:chosen.map(s=>s.id),selectedCount:chosen.length,sampledItemIds:sampled.map(x=>x.id),sampledCount:sampled.length,selectedAt:new Date().toISOString()};
 raw.runs[0]={...raw.runs[0],selectedSourceIds:chosen.map(s=>s.id),selectedCount:chosen.length,sampledItemIds:sampled.map(x=>x.id),discoveryQueries:raw.discovery.queries||[],discoveryScope:raw.discovery.scope};
 await atomic(rawOutput,raw);let view=P.publishFree(raw);view=await M.syncMedia(view,{request,root});await atomic(output,view);
 console.log(JSON.stringify({free:view.items.length,sources:view.sources.filter(s=>s.eligibleCount>0).length,selected:chosen.length,newSources:raw.discovery.newSourceIds,images:view.media.files,missingImages:view.media.missing,discoveryErrors:raw.discovery.errors||[]}));
 if(results.some(x=>!x.ok)||(discovered.discovery.errors||[]).some(x=>x.rateLimited))process.exitCode=1;
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
