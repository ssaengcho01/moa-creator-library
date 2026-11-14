'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {applyTranslations}=require('./lib.cjs');
const {publishFree}=require('./policy.cjs');
const cache=JSON.parse(fs.readFileSync('public/data/ko.json','utf8'));
const ids=['c9e8f28e47000cc90bd7','a4370041b0e5de65ce9b','01bc465e2f125f82241a','5e13c1d4a7b14f3b8a72'];
const rows=ids.map((id,i)=>({id,sourceId:'discovered-test-'+i,title:cache.entries[id].originalTitle,description:cache.entries[id].originalDescription,tags:[],access:'free',pricingEvidence:{checkedAt:'2026-11-14T00:00:00Z'}}));
const base={version:1,items:rows,sources:rows.map(x=>({id:x.sourceId,name:x.sourceId})),runs:[]};
const enriched=applyTranslations(base,cache),visible=publishFree(enriched);
assert.equal(visible.items.length,2);assert.equal(visible.policy.excludedCounts.outOfScope,2);
for(const item of visible.items){assert.match(item.titleKo,/[가-힣]/);assert.match(item.descriptionKo,/[가-힣]/);assert(item.usageKo.length>30);assert.equal(item.stepsKo.length,3);assert(item.cautionsKo);assert(item.referenceUrls.every(u=>u.startsWith('https://github.com/')));assert.equal(item.editorialStatus,'reviewed');}
assert.notEqual(visible.items[0].usageKo,visible.items[1].usageKo);
const unknown={...rows[0],id:'new-unreviewed',sourceId:'discovered-new'};
const pending=applyTranslations({...base,items:[unknown]},cache);assert.equal(publishFree(pending).items.length,0);assert.equal(publishFree(pending).policy.excludedCounts.translationPending,1);
const changed=applyTranslations({...base,items:[{...visible.items[0],description:'Changed original'}]},cache).items[0];assert.equal(changed.titleKo,undefined);assert.equal(changed.usageKo,undefined);assert.equal(changed.editorialStatus,'pending');
console.log('PASS Korean summaries, distinct use cases, steps, evidence, out-of-scope removal, pending gate and changed-source invalidation');
