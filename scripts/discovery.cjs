'use strict';
const config = require('../config/discovery.json');
const defaultSeeds = require('../config/sources.json').sources;
const key = value => String(value || '').toLowerCase();
const ownerOf = source => key(source.owner || String(source.repo || '').split('/')[0] || source.id);
const integer = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, Math.floor(value))) : fallback;
const draw = random => { const n=Number(random()); return Number.isFinite(n) ? Math.max(0,Math.min(0.9999999999999999,n)) : 0; };
function shuffle(values,random) {
  const out=[...values];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(draw(random)*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function safeImage(text) {
  const images=[...text.matchAll(/!\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)(?:\s+[^)]*)?\)/gi)].map(m=>[m[2],m[1]]);
  for(const m of text.matchAll(/<img\b[^>]*>/gi)){
    const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if(src) images.push([src[1],m[0]]);
  }
  for(const [src,context] of images){
    try {
      const u=new URL(src.replace(/&amp;/g,'&'));
      if(u.protocol!=='https:' || u.username || u.password || u.port || !['raw.githubusercontent.com','githubusercontent.com','camo.githubusercontent.com'].includes(u.hostname)) continue;
      if(/badge|shield|logo/i.test(src+' '+context) || /\.svg$/i.test(u.pathname)) continue;
      return u.href;
    } catch {}
  }
  return null;
}
function normalizePool(previous,seeds) {
  const ids=new Set(seeds.map(s=>key(s.id))),owners=new Set(seeds.map(ownerOf)),repos=new Set(seeds.map(s=>key(s.repo)).filter(Boolean)),pool=[];
  for(const s of Array.isArray(previous)?previous:[]){
    if(!s || (config.excludedRepos||[]).some(r=>key(r)===key(s.repo)) || !s.id || s.seed===true || ids.has(key(s.id)) || owners.has(ownerOf(s)) || (s.repo && repos.has(key(s.repo)))) continue;
    pool.push(s);ids.add(key(s.id));owners.add(ownerOf(s));if(s.repo)repos.add(key(s.repo));
    if(pool.length>=config.maxPool) break;
  }
  return pool;
}
async function discoverCandidates(request,previousPool,options={}) {
  if(typeof request!=='function')throw new TypeError('request must return Response');
  const random=options.random || Math.random;
  const rawNow=typeof options.now==='function'?options.now():options.now;
  const at=new Date(rawNow===undefined?Date.now():rawNow).toISOString();
  const seeds=options.seedSources || defaultSeeds,pool=normalizePool(previousPool,seeds);
  const discovery={at,provider:config.provider,scope:config.scope,queries:[],newSourceIds:[],errors:[],poolCount:pool.length};
  const maximum=integer(options.maxNew,2,0,2);
  const owners=new Set([...seeds,...pool].map(ownerOf)),ids=new Set([...seeds,...pool].map(s=>key(s.id))),repos=new Set([...seeds,...pool].map(s=>key(s.repo)).filter(Boolean));
  let readmeRequests=0;
  async function json(url,phase){
    try {
      const response=await request(url);
      if(!response.ok){const error={phase,url,status:response.status,message:'HTTP '+response.status};if([403,429].includes(response.status))error.rateLimited=true;discovery.errors.push(error);return null;}
      const body=await response.json();
      if(!body || typeof body!=='object')throw new Error('Invalid JSON response body');
      return body;
    }catch(error){discovery.errors.push({phase,url,message:String(error.message || error)});return null;}
  }
  async function search(query,page){
    const url='https://api.github.com/search/repositories?q='+encodeURIComponent(query)+'&per_page=30&page='+page;
    discovery.queries.push({query,page,url});
    const result=await json(url,'search');
    if(result && !Array.isArray(result.items)){discovery.errors.push({phase:'search',url,message:'Invalid repository search response'});return null;}
    if(result && result.incomplete_results)discovery.errors.push({phase:'search',url,message:'GitHub reported incomplete search results'});
    return result && result.items;
  }
  // Two different topics; at most two page-1 fallbacks and two README requests.
  for(const topic of shuffle(config.topics,random).slice(0,2)){
    const query=topic.queries[Math.floor(draw(random)*topic.queries.length)]+' fork:false archived:false';
    const page=1+Math.floor(draw(random)*2);
    let results=await search(query,page);
    if(results && !results.length && page===2)results=await search(query,1);
    if(!results)continue;
    for(const repo of shuffle(results,random)){
      if(discovery.newSourceIds.length>=maximum || readmeRequests>=2)break;
      if(!repo || repo.fork || repo.private || repo.disabled || repo.archived || !repo.license || typeof repo.license!=='object')continue;
      const full=String(repo.full_name || '');
      if(!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(full))continue;
      if((config.excludedRepos||[]).some(r=>key(r)===key(full)))continue;
      const owner=full.split('/')[0],id='discovered-'+full.toLowerCase().replace(/[^a-z0-9-]/g,'-');
      if(owners.has(key(owner)) || repos.has(key(full)) || ids.has(key(id)))continue;
      if(repo.url!=='https://api.github.com/repos/'+full || repo.html_url!=='https://github.com/'+full || !repo.default_branch)continue;
      readmeRequests++;
      const readme=await json(repo.url+'/readme','readme');
      if(!readme)continue;
      if(readme.encoding!=='base64' || typeof readme.content!=='string' || !readme.content.trim() || readme.content.length>280000){discovery.errors.push({phase:'readme',url:repo.url+'/readme',message:'Unreadable or oversized README'});continue;}
      // Remote content is data, never executed. Bound both encoded input and decoded text.
      const text=Buffer.from(readme.content,'base64').toString('utf8').slice(0,200000);
      if(!text.trim() || text.includes('\u0000') || !topic.terms.some(term=>text.toLowerCase().includes(term.toLowerCase())))continue;
      let readmeUrl;
      try{const u=new URL(readme.html_url);if(u.protocol!=='https:' || u.hostname!=='github.com' || !u.pathname.startsWith('/'+full+'/blob/'))continue;readmeUrl=u.href;}catch{continue;}
      const source={id,name:topic.label+' · '+owner,owner,repo:full,branch:repo.default_branch,url:repo.html_url,kind:'github-repository',feed:repo.url,seed:false,discoveredAt:at,discoveryQuery:query,topicLabel:topic.label,displayTitle:topic.label+' · '+(repo.name || full.split('/')[1]),displayDescription:topic.label+' 주제로 검색해 공개 README 열람을 확인한 자료입니다. 실행 도구·외부 서비스의 비용과 개별 라이선스는 별도 확인이 필요합니다.',originalDescription:repo.description || '',readmeUrl,readmeSha:readme.sha || null,thumbnailUrl:safeImage(text)};
      if(pool.length>=config.maxPool)pool.splice(pool.findLastIndex(s=>!discovery.newSourceIds.includes(s.id)),1);
      pool.push(source);owners.add(key(owner));repos.add(key(full));ids.add(key(id));discovery.newSourceIds.push(id);
    }
  }
  discovery.poolCount=pool.length;
  return {pool,discovery};
}
function selectSources(sources,options={}) {
  const random=options.random || Math.random,min=integer(options.min,4,0,10000),max=integer(options.max,10,min,10000);
  const unique=[],owners=new Set(),ids=new Set(),fresh=new Set(options.newIds || []),shuffled=shuffle(sources || [],random);
  // Prefer new IDs before owner deduplication so a same-owner old entry cannot hide one.
  for(const s of [...shuffled.filter(s=>s && fresh.has(s.id)),...shuffled.filter(s=>s && !fresh.has(s.id))]){
    if(!s.id || owners.has(ownerOf(s)) || ids.has(key(s.id)))continue;
    unique.push(s);owners.add(ownerOf(s));ids.add(key(s.id));
  }
  const size=Math.min(unique.length,min+Math.floor(draw(random)*(max-min+1)));
  if(!size)return [];
  const first=unique.find(s=>fresh.has(s.id));
  const chosen=first?[first,...shuffle(unique.filter(s=>s!==first),random).slice(0,size-1)]:shuffle(unique,random).slice(0,size);
  return shuffle(chosen,random);
}
function sampleItems(items,options={}){return shuffle(items || [],options.random || Math.random).slice(0,integer(options.limit,12,0,1000000));}
module.exports={discoverCandidates,selectSources,sampleItems};
