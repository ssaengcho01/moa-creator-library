'use strict';
const crypto = require('node:crypto');
const fs=require('node:fs');const path=require('node:path');
const SOURCES=JSON.parse(fs.readFileSync(path.join(process.cwd(),'config/sources.json'),'utf8')).sources;
function canonical(value) {
 const u = new URL(value); if(!['https:','http:'].includes(u.protocol)) throw new Error('Unsupported URL');
 u.hash=''; for(const k of [...u.searchParams.keys()]) if(/^utm_|^(fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
 u.searchParams.sort(); return u.href;
}
function idFor(url) {return crypto.createHash('sha256').update(canonical(url)).digest('hex').slice(0,20);}
function decode(s) {return String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,c)=>String.fromCodePoint(c[0].toLowerCase()==='x'?parseInt(c.slice(1),16):Number(c))).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function plain(s) {return decode(String(s||'').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();}
const CAT={image:'이미지',video:'영상',automation:'자동화',tool:'AI 도구',news:'AI 뉴스',prompt:'프롬프트',download:'다운로드','landing-pages':'웹사이트',hero:'웹사이트',threejs:'3D · WebGL','three-js':'3D · WebGL','3d-assets':'3D · WebGL',backgrounds:'배경 · 효과',buttons:'UI 컴포넌트',sections:'UI 컴포넌트','text-animation':'모션','motion-design':'모션','ui-elements':'UI 컴포넌트',css:'UI 컴포넌트'};
function promptItems(payload) {
 const arr=Array.isArray(payload)?payload:payload.items;
 if(!Array.isArray(arr)||!arr.length) throw new Error('프롬왓 목록이 비어 있거나 구조가 변경됨');
 const source=SOURCES[0];
 const items=arr.filter(x=>x.title&&x.material_url).map(x=>({id:idFor(x.material_url),url:canonical(x.material_url),title:String(x.title).trim(),description:String(x.description||'').slice(0,500),sourceId:source.id,sourceName:source.name,sourceUrl:source.url,sourceEntryUrl:x.notion_page_url||source.url,originalSocialUrl:x.cover_source||null,thumbnailSourceUrl:x.cover?new URL(x.cover,source.url).href:null,thumbnailAlt:String(x.title)+' 원본 게시물 표지',thumbnailType:'page-image',collectionMethod:'공개 자료실의 목록 데이터',category:CAT[x.primary_category]||'AI 도구',tags:Array.isArray(x.tools)?x.tools.map(String).slice(0,12):[],publishedAt:/^\d{4}-\d{2}-\d{2}$/.test(x.published_at)?x.published_at:null,access:'public-link',accessNote:'자료실에 공개된 직접 링크입니다. 연결 자료의 로그인·유료 여부와 내용은 개별 확인이 필요합니다.'}));
 if(!items.length) throw new Error('유효한 프롬왓 항목이 없음'); return items;
}
function threeItems(html) {
 const tag=html.match(/<script\b[^>]*id=["']threeui-structured-data["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!tag) throw new Error('ThreeUI 공개 구조화 데이터가 변경됨');
 const data=JSON.parse(tag[1]); const list=data.mainEntity?.itemListElement;
 if(!Array.isArray(list)||!list.length) throw new Error('ThreeUI 목록이 비어 있음');
 const desc=new Map();
 for(const m of html.matchAll(/<li\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi)) {
  try {desc.set(canonical(new URL(decode(m[1]),SOURCES[1].url).href),plain(m[2]));} catch {}
 }
 const s=SOURCES[1]; const items=[];
 for(const x of list) {
  if(!x.name||!x.url) continue;
  try {const url=canonical(x.url); const u=new URL(url); if(u.hostname!=='threeui.com') continue;
   const type=u.pathname.split('/').filter(Boolean)[0]||'threejs';
   items.push({id:idFor(url),url,title:String(x.name).trim(),description:(desc.get(url)||'ThreeUI의 공개 컴포넌트 목록입니다. 원문에서 데모와 이용 조건을 확인하세요.').slice(0,500),sourceId:s.id,sourceName:s.name,sourceUrl:s.url,category:CAT[type]||'3D · WebGL',tags:['Three.js',type],publishedAt:null,access:'unknown',accessNote:'공개 목록만 수집했습니다. 무료·Pro 여부, 소스 및 프롬프트 접근 조건은 원문에서 확인하세요.'});
  } catch {}
 }
 if(items.length<Math.max(1,list.length*0.8)) throw new Error('ThreeUI 항목 검증 실패');
 return items;
}
function robotsAllowed(text,url,agent='DesignShelf') {
 const groups=[]; let agents=[],rules=[],hasRules=false;
 const save=()=>{if(agents.length) groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[];hasRules=false;};
 for(const line of String(text).split(/\r?\n/)) {
  const s=line.replace(/#.*$/,'').trim(); if(!s.includes(':'))continue;
  const k=s.slice(0,s.indexOf(':')).trim().toLowerCase(),v=s.slice(s.indexOf(':')+1).trim();
  if(k==='user-agent'){if(hasRules)save();agents.push(v.toLowerCase());}
  else if((k==='allow'||k==='disallow')&&agents.length){hasRules=true;if(v)rules.push({allow:k==='allow',path:v});}
 } save();
 const a=agent.toLowerCase(); let selected=groups.filter(g=>g.agents.some(x=>x!=='*'&&a.includes(x)));
 if(!selected.length)selected=groups.filter(g=>g.agents.includes('*'));
 const u=new URL(url); const p=u.pathname+u.search; let winning=null;
 for(const r of selected.flatMap(g=>g.rules)) {
  const escaped=r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
  const pattern=escaped.endsWith('\\$')?escaped.slice(0,-2)+'$':escaped;
  if(new RegExp('^'+pattern).test(p)) {const n=r.path.replace(/\*/g,'').length;if(!winning||n>winning.n||(n===winning.n&&r.allow))winning={...r,n};}
 } return !winning||winning.allow;
}
function mergeLibrary(previous,results,at=new Date().toISOString(),sources=SOURCES) {
 const old=previous||{items:[],sources:[],runs:[]}; const map=new Map(old.items.map(x=>[canonical(x.url),{...x}]));
 const baseline=!old.runs?.length; const statuses=[]; let added=0,changed=0;
 for(const s of sources) {
  const res=results.find(x=>x.id===s.id); const prior=old.sources.find(x=>x.id===s.id);
  if(!res){statuses.push({...prior,id:s.id,name:s.name,url:s.url,status:prior?.status==='error'?'error':'not-run',lastAttemptAt:prior?.lastAttemptAt||null,lastSuccessAt:prior?.lastSuccessAt||null,itemCount:prior?.itemCount||0,newCount:0,changedCount:0,error:prior?.error||null,selectedThisRun:false});continue;}
  if(!res.ok) {statuses.push({...prior,id:s.id,name:s.name,url:s.url,status:'error',lastAttemptAt:at,lastSuccessAt:prior?.lastSuccessAt||null,itemCount:prior?.itemCount||0,newCount:0,changedCount:0,error:String(res?.error||'수집 결과 없음').slice(0,500)});continue;}
  let n=0,c=0;
  for(const item of res.items) {
   const key=canonical(item.url),found=map.get(key);
   if(found) {const fields=['title','description','category','tags','access','accessNote','publishedAt','sourceRevision']; const different=fields.some(k=>JSON.stringify(found[k])!==JSON.stringify(item[k]));
    map.set(key,{...found,...item,id:found.id,firstSeenAt:found.firstSeenAt,lastSeenAt:at,updatedAt:different?at:found.updatedAt}); if(different)c++;
   } else {map.set(key,{...item,firstSeenAt:at,lastSeenAt:at,updatedAt:at}); if(!baseline)n++;}
  }
  added+=n;changed+=c;statuses.push({id:s.id,name:s.name,url:s.url,status:'ok',selectedThisRun:true,lastAttemptAt:at,lastSuccessAt:at,itemCount:res.items.length,newCount:n,changedCount:c,error:null});
 }
 return {version:1,updatedAt:at,items:[...map.values()].sort((a,b)=>b.firstSeenAt.localeCompare(a.firstSeenAt)||(b.publishedAt||'').localeCompare(a.publishedAt||'')||a.title.localeCompare(b.title)),sources:statuses,runs:[{at,newCount:added,changedCount:changed,baseline,sourcesOk:results.filter(x=>x.ok).length,totalSources:sources.length},...(old.runs||[])].slice(0,60)};
}
function applyTranslations(library,cache={entries:{}}) {
 let translated=0,pending=0;
 const items=library.items.map(item=>{
  const {titleKo,descriptionKo,translationStatus,usageKo,stepsKo,audienceKo,requirementsKo,cautionsKo,referenceUrls,reviewedAt,editorialStatus,exclusionReason,...base}=item;
  const entry=cache.entries?.[item.id];
  const current=entry&&entry.originalTitle===item.title&&entry.originalDescription===item.description;
  if(current&&entry.excludeFromLibrary===true)return {...base,editorialStatus:'excluded',exclusionReason:entry.exclusionReason,reviewedAt:entry.reviewedAt,referenceUrls:entry.referenceUrls,translationStatus:'excluded'};
  if(current&&typeof entry.titleKo==='string'&&/[가-힣]/.test(entry.titleKo)&&typeof entry.descriptionKo==='string'&&/[가-힣]/.test(entry.descriptionKo)){
   translated++;return {...base,titleKo:entry.titleKo,descriptionKo:entry.descriptionKo,translationStatus:'translated',...(entry.editorialStatus==='reviewed'?{editorialStatus:'reviewed',usageKo:entry.usageKo,stepsKo:entry.stepsKo,audienceKo:entry.audienceKo,requirementsKo:entry.requirementsKo,cautionsKo:entry.cautionsKo,referenceUrls:entry.referenceUrls,reviewedAt:entry.reviewedAt}:{})};
  }
  if(item.sourceId!=='threeui'&&!item.sourceId.startsWith('discovered-'))return {...base,translationStatus:'native'};
  pending++;return {...base,translationStatus:'pending',...(item.sourceId.startsWith('discovered-')?{editorialStatus:'pending'}:{})};
 });
 return {...library,items,sources:library.sources.map(s=>({...s,name:cache.sourceNames?.[s.id]||s.name})),localization:{language:'ko',translated,pending,updatedAt:cache.updatedAt||null}};
}
module.exports={SOURCES,canonical,idFor,promptItems,threeItems,mergeLibrary,robotsAllowed,applyTranslations};
