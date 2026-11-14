'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const X=require('./extra-sources.cjs'),M=require('./media.cjs');let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
 const source={id:'maker',name:'제작자',repo:'maker/free',branch:'main',url:'https://github.com/maker/free',items:[{path:'pack',titleKo:'영상 예제',descriptionKo:'공개 영상 예제 모음',category:'영상',thumbnailPath:'pack/preview.png'}]};
 const tree={truncated:false,tree:[{path:'pack',type:'tree',sha:'revision-1'},{path:'pack/preview.png',type:'blob',sha:'p'}]};
 await test('curated GitHub collection must exist in actual tree',()=>{const [item]=X.githubItems(source,tree);assert.equal(item.title,'영상 예제');assert.equal(item.access,'free');assert.match(item.url,/tree\/main\/pack$/);assert.match(item.thumbnailSourceUrl,/preview.png$/);assert.equal(item.sourceRevision,'revision-1');});
 await test('truncated and vanished GitHub paths fail closed',()=>{assert.throws(()=>X.githubItems(source,{...tree,truncated:true}));assert.throws(()=>X.githubItems(source,{tree:[{path:'other'}]}));});
 await test('only Free-labelled Filatov card is accepted',()=>{const items=X.filatovItems({id:'f',name:'필라토프',url:'https://filatov.design/sites'},'<a href="./sites/then">THEN <b>Free</b></a><a href="./sites/pro">PRO Pro</a>');assert.equal(items.length,1);assert.match(items[0].url,/sites\/then$/);});
 await test('private discovered repositories are rejected',()=>assert.throws(()=>X.discoveredRepoItem({repo:'a/b'},{private:true})));
 await test('thumbnail URL guard rejects local networks and unrelated hosts',()=>{assert.equal(M.safeImageUrl('http://127.0.0.1/x.png'),false);assert.equal(M.safeImageUrl('https://evil.example/a.png'),false);assert.equal(M.safeImageUrl('https://raw.githubusercontent.com/a/b/main/a.png'),true);});
 await test('non-image and oversized responses rejected',async()=>{await assert.rejects(()=>M.limitedImage(new Response('html',{headers:{'content-type':'text/html'}}),10));await assert.rejects(()=>M.limitedImage(new Response('long bytes',{headers:{'content-type':'image/png'}}),2));});
 const root=path.join(process.cwd(),'.test-media');await fs.rm(root,{recursive:true,force:true});let requests=0;
 const request=async()=>{requests++;return new Response('image-bytes',{headers:{'content-type':'image/png'}});};
 const items=[1,2].map(n=>({id:String(n),url:'https://github.com/a/'+n,title:'자료',thumbnailSourceUrl:'https://raw.githubusercontent.com/a/b/main/p.png'}));
 try{
 await test('same source thumbnail shared and reused without new local files',async()=>{const first=await M.syncMedia({items},{root,request});assert.equal(first.media.files,1);assert.equal(requests,1);assert.equal(first.items[0].thumbnail,first.items[1].thumbnail);const again=await M.syncMedia({items},{root,request});assert.equal(requests,1);assert.equal(again.media.files,1);});
 await test('unused thumbnail files pruned instead of accumulating',async()=>{const out=await M.syncMedia({items:[]},{root,request});assert.equal(out.media.files,0);assert.equal((await fs.readdir(path.join(root,'public/thumbnails'))).length,0);});
 }finally{await fs.rm(root,{recursive:true,force:true});}
 console.log(count+' extra source/media tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
