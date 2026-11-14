'use strict';
const assert=require('node:assert/strict');
const {discoverCandidates,selectSources,sampleItems}=require('./discovery.cjs');
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
const now='2026-11-14T01:00:00.000Z';
const evidence='ComfyUI image generation diffusion video generation text-to-video Remotion motion graphics design system creative coding presentation slides creator productivity vibe coding AI coding';
const repository=(owner='alice',name='tool',extra={})=>({name,full_name:owner+'/'+name,owner:{login:owner},default_branch:'main',url:'https://api.github.com/repos/'+owner+'/'+name,html_url:'https://github.com/'+owner+'/'+name,description:'Original public resource',fork:false,private:false,disabled:false,archived:false,license:{spdx_id:'MIT'},...extra});
const readme=(repo,text=evidence)=>({encoding:'base64',content:Buffer.from(text).toString('base64'),html_url:repo.html_url+'/blob/main/README.md',sha:'fixture-sha'});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function mock(repos,readmeFactory=repo=>readme(repo)){
  const calls=[];
  const request=async url=>{
    calls.push(url);
    if(url.includes('/search/repositories?'))return response({items:repos});
    const repo=repos.find(r=>url===r.url+'/readme');
    return repo?response(readmeFactory(repo)):response({},404);
  };
  return {calls,request};
}
const options={now,random:()=>0,seedSources:[]};
(async()=>{
  await test('two varied queries and at most two distinct new owners',async()=>{
    const m=mock([repository('alice'),repository('bob'),repository('alice','other')]);
    const out=await discoverCandidates(m.request,[],options);
    assert.equal(out.pool.length,2);assert.equal(new Set(out.pool.map(s=>s.owner)).size,2);
    assert.equal(out.discovery.queries.length,2);assert.notEqual(out.discovery.queries[0].query,out.discovery.queries[1].query);
    assert.equal(m.calls.filter(u=>u.endsWith('/readme')).length,2);
    assert.equal(out.discovery.provider,'github-public-search');assert.match(out.discovery.scope,/SNS/);
    assert.equal(out.discovery.at,now);assert.equal(out.discovery.poolCount,2);
    for(const s of out.pool){assert.equal(s.kind,'github-repository');assert.equal(s.seed,false);assert.equal(s.readmeSha,'fixture-sha');assert.equal(s.thumbnailUrl,null);assert.match(s.displayTitle,/ · /);assert.match(s.displayDescription,/비용/);assert.equal(s.originalDescription,'Original public resource');}
  });
  await test('seed owner and previous sources never overwritten; case-insensitive deduplication',async()=>{
    const old={id:'saved',owner:'alice',repo:'alice/saved',seed:false};
    const seed={id:'seed',owner:'bob',repo:'bob/seed'};
    const input=[old,{...old,id:'duplicate',owner:'ALICE'},seed];
    const m=mock([repository('ALICE','new'),repository('bob','new'),repository('carol')]);
    const out=await discoverCandidates(m.request,input,{...options,seedSources:[seed]});
    assert.equal(out.pool[0],old);assert.equal(out.pool.length,2);assert.equal(out.pool[1].owner,'carol');assert.equal(input.length,3);
  });
  await test('forks/private/disabled/archived/unlicensed rejected before README',async()=>{
    const repos=['fork','private','disabled','archived'].map((flag,i)=>repository('bad'+i,'tool',{[flag]:true}));
    repos.push(repository('unlicensed','tool',{license:null}));
    const m=mock(repos),out=await discoverCandidates(m.request,[],options);
    assert.equal(out.pool.length,0);assert.equal(m.calls.length,2);
  });
  await test('empty page two falls back to page one, bounded four searches',async()=>{
    const calls=[];
    const out=await discoverCandidates(async url=>{calls.push(url);return response({items:[]});},[],{...options,random:()=>0.99});
    assert.equal(calls.length,4);assert.deepEqual(out.discovery.queries.map(q=>q.page),[2,1,2,1]);
  });
  await test('403 and 429 are visible errors, not successful empty searches',async()=>{
    let n=0;const out=await discoverCandidates(async()=>response({},n++?429:403),[],options);
    assert.deepEqual(out.discovery.errors.map(e=>e.status),[403,429]);assert(out.discovery.errors.every(e=>e.rateLimited));assert.equal(out.discovery.queries.length,2);
  });
  await test('network and malformed provider errors retained',async()=>{
    let n=0;const out=await discoverCandidates(async()=>{if(!n++)throw Error('offline');return response({wrong:[]});},[],options);
    assert.equal(out.discovery.errors.length,2);assert.match(out.discovery.errors[0].message,/offline/);
  });
  await test('README must be readable and contain evidence for chosen topic',async()=>{
    const m=mock([repository('alice'),repository('bob')],r=>readme(r,'unrelated accounting data'));
    const out=await discoverCandidates(m.request,[],options);assert.equal(out.pool.length,0);assert.equal(m.calls.filter(u=>u.endsWith('/readme')).length,2);
  });
  await test('README fetch error and oversized data cannot become candidates',async()=>{
    const repos=[repository('alice'),repository('bob')];
    const m=mock(repos,r=>({...readme(r),content:'Y'.repeat(280001)}));
    const out=await discoverCandidates(m.request,[],options);assert.equal(out.pool.length,0);assert.equal(out.discovery.errors.length,2);
    const failed=await discoverCandidates(async url=>url.includes('/search/')?response({items:repos}):response({},404),[],options);
    assert.equal(failed.pool.length,0);assert(failed.discovery.errors.some(e=>e.status===404));
  });
  await test('README image only: reject badges logos SVG and unsafe hosts',async()=>{
    const text=evidence+'\n![badge](https://raw.githubusercontent.com/a/b/main/badge.png)\n![logo](https://raw.githubusercontent.com/a/b/main/logo.png)\n![x](https://raw.githubusercontent.com/a/b/main/a.svg)\n![x](https://evil.example/a.png)\n![preview](https://raw.githubusercontent.com/a/b/main/example.png)';
    const m=mock([repository()],r=>readme(r,text));const out=await discoverCandidates(m.request,[],options);
    assert.equal(out.pool[0].thumbnailUrl,'https://raw.githubusercontent.com/a/b/main/example.png');
  });
  await test('pool capped at 200 while newest candidate retained',async()=>{
    const old=Array.from({length:205},(_,i)=>({id:'old'+i,owner:'owner'+i,repo:'owner'+i+'/tool',seed:false}));
    const m=mock([repository('newowner'),repository('secondnew')]);const out=await discoverCandidates(m.request,old,options);
    assert.equal(out.pool.length,200);assert(out.pool.some(s=>s.owner==='newowner'));assert.equal(out.discovery.newSourceIds.length,2);assert(out.discovery.newSourceIds.every(id=>out.pool.some(s=>s.id===id)));assert.equal(old.length,205);
  });
  await test('maxNew is capped at two and zero disables README requests',async()=>{
    const m=mock([repository('a'),repository('b'),repository('c')]);
    assert.equal((await discoverCandidates(m.request,[],{...options,maxNew:100})).pool.length,2);
    const z=mock([repository()]);assert.equal((await discoverCandidates(z.request,[],{...options,maxNew:0})).pool.length,0);assert.equal(z.calls.length,2);
  });
  const sources=Array.from({length:20},(_,i)=>({id:'s'+i,owner:'o'+i}));
  await test('source selection random 4..10 independent owners with guaranteed new ID',()=>{
    const input=[...sources,{id:'duplicate-owner',owner:'O1'}];
    const low=selectSources(input,{random:()=>0,newIds:['s19']}),high=selectSources(input,{random:()=>0.99,newIds:['s19']});
    assert.equal(low.length,4);assert.equal(high.length,10);assert(low.some(s=>s.id==='s19'));assert(high.some(s=>s.id==='s19'));assert.equal(new Set(high.map(s=>s.owner.toLowerCase())).size,10);assert.notDeepEqual(low,high);assert.equal(input.length,21);
    assert.equal(selectSources(sources.slice(0,2),{random:()=>0}).length,2);assert.deepEqual(selectSources([]),[]);
  });
  await test('new ID wins same-owner deduplication',()=>{
    const selected=selectSources([{id:'old',owner:'same'},{id:'new',owner:'SAME'}],{random:()=>0,newIds:['new']});assert.equal(selected[0].id,'new');
  });
  await test('item sampling shuffled bounded deterministic and nonmutating',()=>{
    const items=Array.from({length:20},(_,i)=>i),a=sampleItems(items,{random:()=>0}),b=sampleItems(items,{random:()=>0.99});
    assert.equal(a.length,12);assert.equal(new Set(a).size,12);assert.notDeepEqual(a,b);assert.deepEqual(a,sampleItems(items,{random:()=>0}));assert.equal(items[0],0);assert.equal(sampleItems(items,{limit:3}).length,3);
  });
  console.log(count+' discovery tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
