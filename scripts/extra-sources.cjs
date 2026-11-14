'use strict';
const crypto=require('node:crypto');
const idFor=url=>crypto.createHash('sha256').update(url).digest('hex').slice(0,20);
const encodePath=p=>p.split('/').map(encodeURIComponent).join('/');
function githubItems(source,payload,at=new Date().toISOString()){
 if(payload.truncated)throw new Error('GitHub 목록이 잘려 있어 완전한 수집으로 처리할 수 없음');
 if(!Array.isArray(payload.tree)||!payload.tree.length)throw new Error('GitHub 공개 파일 목록 구조 변경');
 const map=new Map(payload.tree.map(x=>[x.path,x]));const items=[];
 for(const config of source.items||[]){
  const entry=map.get(config.path);if(!entry)continue;
  const url=config.url||`https://github.com/${source.repo}/${entry.type==='tree'?'tree':'blob'}/${source.branch}/${encodePath(config.path)}`;
  const imagePath=config.thumbnailPath&&map.has(config.thumbnailPath)?config.thumbnailPath:null;
  const image=config.thumbnailUrl||(imagePath?`https://raw.githubusercontent.com/${source.repo}/${source.branch}/${encodePath(imagePath)}`:null);
  items.push({id:idFor(url),url,title:config.titleKo,description:config.descriptionKo,usageKo:config.usageKo,stepsKo:config.stepsKo,requirementsKo:config.requirementsKo,cautionsKo:config.cautionsKo,referenceUrls:config.referenceUrls,reviewedAt:config.reviewedAt,sourceId:source.id,sourceName:source.name,sourceUrl:source.url,sourceEntryUrl:config.evidenceUrl||source.evidenceUrl||source.url,collectionMethod:'제작자 공개 저장소의 실제 파일·폴더 목록과 대조',sourceRevision:entry.sha,category:config.category||'자료 모음',tags:config.tags||[],publishedAt:null,access:'free',accessNote:'공개 저장소의 설명과 파일은 결제 없이 열람·다운로드할 수 있습니다. 실행 환경·모델·API·상업적 이용 조건은 별도입니다.',pricingEvidence:{sourceUrl:url,method:'공개 저장소에서 해당 파일·폴더 존재 및 무료 열람 확인',checkedAt:at,license:source.license||'원문 확인'},toolCost:'unverified',toolCostNote:source.thirdPartyNotes||'도구 실행 요금과 라이선스 조건은 원문에서 별도로 확인하세요.',thumbnailSourceUrl:image,thumbnailAlt:config.titleKo+' 원본 페이지 미리보기',thumbnailType:'page-image',selectionMethod:'검증한 제작자 자료 중 선별한 컬렉션'});
 }
 if(!items.length)throw new Error('선별한 공개 자료의 경로가 모두 사라짐');return items;
}
function filatovItems(source,html,at=new Date().toISOString()){
 const result=new Map();
 for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const text=m[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();if(!/\bFree\b/.test(text))continue;
  let u;try{u=new URL(m[1],source.url);}catch{continue;}if(u.hostname!=='filatov.design'||!/^\/sites\/[^/]+\/?$/.test(u.pathname))continue;
  const url=u.href.replace(/\/$/,'');const name=text.replace(/\bFree\b/g,'').trim();const then=u.pathname.endsWith('/then');
  result.set(url,{id:idFor(url),url,title:then?'숲과 지도를 담은 시네마틱 웹사이트 · THEN':'무료 웹사이트 시스템 · '+name,description:then?'숲 영상, 인터랙티브 지도와 아카이브를 담은 웹사이트를 Claude Code·Codex용 프롬프트로 재구성하는 무료 시스템.':'웹사이트를 프롬프트로 재구성하는 시스템입니다. 제작자 목록에서 무료 표시를 확인한 자료만 수집합니다.',sourceId:source.id,sourceName:source.name,sourceUrl:source.url,sourceEntryUrl:source.url,sourceRevision:null,collectionMethod:'제작자 웹사이트의 Free 표시가 있는 카드만 추출',category:'웹사이트',tags:['AI 디자인','바이브코딩','프롬프트'],publishedAt:null,access:'free',accessNote:'해당 시스템은 무료 표시가 있습니다. 제작자의 전체 유료 구독이나 AI 코딩 도구 사용료는 별도입니다.',pricingEvidence:{sourceUrl:source.url,method:'제작자 자료 목록의 해당 카드 Free 표시 확인',checkedAt:at},toolCost:'unverified',toolCostNote:source.thirdPartyNotes,thumbnailSourceUrl:null,thumbnailAlt:name+' 실제 데모 페이지 캡처',thumbnailType:'page-screenshot'});
 }
 if(!result.size)throw new Error('무료 시스템 카드가 없거나 목록 구조가 변경됨');return [...result.values()];
}
function discoveredRepoItem(source,repo,at=new Date().toISOString()){
 if(repo.private!==false||repo.disabled||repo.archived||repo.fork||repo.full_name!==source.repo)throw new Error('공개·활성·독립 저장소 조건을 충족하지 않음');
 if(!source.readmeSha||!source.readmeUrl)throw new Error('신규 출처 README 검증 근거 없음');
 const url=source.readmeUrl;
 return [{id:idFor(url),url,title:source.displayTitle||source.topicLabel+' 공개 자료',description:source.displayDescription||'관심 주제로 발견한 공개 자료입니다. 원문 소개와 실행 조건을 확인하세요.',originalTitle:repo.name,originalDescription:repo.description||'',sourceId:source.id,sourceName:source.name,sourceUrl:source.url,sourceEntryUrl:source.url,sourceRevision:source.readmeSha,collectionMethod:'무작위 관심 주제 검색 후 공개 저장소·README 검증',category:source.topicLabel||'AI 도구',tags:[source.topicLabel||'AI 도구','새 출처'],publishedAt:null,access:'free',accessNote:'공개 README와 저장소 파일은 무료로 읽을 수 있습니다. 연결된 서비스와 실행 비용·라이선스는 별도입니다.',pricingEvidence:{sourceUrl:url,method:'공개 저장소와 README 접근 확인',checkedAt:at,license:repo.license?.spdx_id||'원문 확인'},toolCost:'unverified',toolCostNote:'새로 발견한 출처입니다. 외부 도구 사용료와 모델·코드의 이용 조건을 원문에서 확인하세요.',thumbnailSourceUrl:source.thumbnailUrl||null,thumbnailAlt:source.displayTitle+' 원본 페이지 미리보기',thumbnailType:'page-image',selectionMethod:'관심 주제 기반 무작위 신규 출처',reviewStatus:'공개 접근·주제 자동 확인'}];
}
function consolidateCollections(library,sources){if(!library)return library;const singles=new Map(sources.filter(s=>s.collectionMode==='single').map(s=>[s.id,new Set((s.items||[]).map(x=>x.url))]));return {...library,items:library.items.filter(x=>!singles.has(x.sourceId)||singles.get(x.sourceId).has(x.url))};}
module.exports={githubItems,filatovItems,discoveredRepoItem,consolidateCollections};
