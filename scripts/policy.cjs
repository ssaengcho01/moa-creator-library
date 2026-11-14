'use strict';
const TOPICS=['AI 디자인','AI 이미지·영상','AI 모션그래픽','바이브코딩','강의·콘텐츠 제작','업무 자동화·생산성'];
function freeGroups(bundle){
 const rule=bundle.match(/function\s+[\w$]+\((\w+)\)\{return!\1\?\.id\|\|!([\w$]+)\.has\(String\(\1\.id\)\)\}/);
 if(!rule)throw new Error('ThreeUI 무료 판별 함수가 변경됨');
 const name=rule[2].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=bundle.match(new RegExp(name+'=new Set\\((\\[[\\s\\S]*?\\])\\)'));
 if(!match)throw new Error('ThreeUI 무료 목록을 찾지 못함');
 const ids=JSON.parse(match[1]);if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(x=>typeof x!=='string'))throw new Error('ThreeUI 무료 목록 구조 오류');return new Set(ids);
}
function classifyThreeUI(items,bundle,bundleUrl,at=new Date().toISOString()){
 const groups=freeGroups(bundle);
 return items.map(item=>{
  const path=new URL(item.url).pathname.split('/').filter(Boolean);const groupId=path.slice(1).find(x=>groups.has(x));
  let thumbnailSourceUrl=null;if(groupId){const escaped=groupId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const image=bundle.match(new RegExp('\\{id:"'+escaped+'",[\\s\\S]{0,900}?thumbnail:"([^"]+)"'));if(image)thumbnailSourceUrl=new URL(image[1],'https://threeui.com').href;}
  return {...item,thumbnailSourceUrl,thumbnailAlt:item.title+' 원본 페이지 이미지',thumbnailType:'page-image',access:groupId?'free':'paid',accessNote:groupId?'ThreeUI 공식 사이트의 무료 그룹에 포함된 항목입니다. 표시 확인일 기준이며 상업적 이용권과 외부 유료 도구 사용료를 보장하지 않습니다.':'ThreeUI 공식 무료 허용 목록에 포함되지 않아 유료로 분류했습니다.',pricingEvidence:{sourceUrl:'https://threeui.com/browse?sort=recent',bundleUrl,method:'공식 사이트의 무료 그룹 분류와 자료 주소 대조',groupId:groupId||null,checkedAt:at}};
 });
}
function inScope(item){return Boolean(item.sourceId);}
function applyReadingEvidence(raw,cache={entries:{}}){
 return {...raw,items:raw.items.map(item=>{const proof=cache.entries?.[item.id];if(item.sourceId!=='promptwhat'||!proof||proof.url!==item.url||!proof.checkedAt)return item;return {...item,access:'free',accessNote:'가이드 본문이 로그인·결제 없이 공개되어 있음을 확인했습니다. 소개 도구의 사용 요금과는 별개입니다.',pricingEvidence:{sourceUrl:item.url,method:'브라우저에서 로그인·결제 없이 가이드 본문 확인',checkedAt:proof.checkedAt},contentTitle:proof.contentTitle,toolCost:proof.toolCost||'unverified',toolCostNote:proof.toolCostNote||'소개 도구의 요금제·크레딧 조건은 원문에서 별도로 확인하세요.'};})};
}
function publishFree(raw){
 const excluded={paid:0,unverified:0,outOfScope:0,translationPending:0};const eligible=[];
 for(const item of raw.items){
  if(!inScope(item)||item.editorialStatus==='excluded'){excluded.outOfScope++;continue;}
  if(item.access==='paid'){excluded.paid++;continue;}
  if(item.access!=='free'||!item.pricingEvidence?.checkedAt){excluded.unverified++;continue;}
  if(item.translationStatus==='pending'||(item.sourceId.startsWith('discovered-')&&item.editorialStatus!=='reviewed')){excluded.translationPending++;continue;}
  eligible.push({...item,topicLabels:item.sourceId==='threeui'?['AI 디자인','바이브코딩']:['강의·콘텐츠 제작','업무 자동화·생산성'],topicBasis:item.sourceId==='threeui'?'AI 코딩 도구에 적용할 수 있는 디자인·코드 참고 자료입니다. AI로 생성되었다는 뜻은 아닙니다.':undefined});
 }
 const sources=raw.sources.map(s=>({...s,eligibleCount:eligible.filter(x=>x.sourceId===s.id).length,paidCount:raw.items.filter(x=>x.sourceId===s.id&&x.access==='paid').length,unverifiedCount:raw.items.filter(x=>x.sourceId===s.id&&!['free','paid'].includes(x.access)).length}));
 return {...raw,items:eligible,sources,localization:raw.localization?{...raw.localization,translated:eligible.filter(x=>x.translationStatus==='translated').length,pending:eligible.filter(x=>x.translationStatus==='pending').length}:undefined,policy:{freeOnly:true,topics:TOPICS,checkedAt:new Date().toISOString(),originalItemCount:raw.items.length,visibleItemCount:eligible.length,excludedCounts:excluded,notice:'자료 자체가 무료로 공개된 항목만 표시합니다. 유료 자료와 무료 여부 미확인 자료는 제외하며, 소개 도구의 비용은 별도입니다. 크리에이터·강사·디자이너를 위한 디자인·영상·모션·코딩·생산성 자료를 수집합니다.'}};
}
module.exports={TOPICS,freeGroups,classifyThreeUI,inScope,applyReadingEvidence,publishFree};
