'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
const MIME={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
function safeImageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='threeui.com'||u.hostname==='promptwhat-ai-library.promptwhatt.chatgpt.site'||u.hostname==='raw.githubusercontent.com'||u.hostname==='camo.githubusercontent.com'||u.hostname==='framerusercontent.com'||u.hostname.endsWith('.framerusercontent.com')||u.hostname.endsWith('.githubusercontent.com'));}catch{return false;}}
async function limitedImage(response,limit){if(!response.ok)throw new Error('image HTTP '+response.status);const type=(response.headers.get('content-type')||'').split(';')[0].trim();if(!MIME[type])throw new Error('unsupported image type '+type);if(Number(response.headers.get('content-length')||0)>limit)throw new Error('image too large');const chunks=[];let size=0;const reader=response.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('image too large');}chunks.push(value);}return {bytes:Buffer.concat(chunks),type,ext:MIME[type]};}
async function syncMedia(library,{request,root=process.cwd(),maxBytes=200*1024*1024,maxFiles=500,now=new Date().toISOString()}={}){
 const directory=path.join(root,'public/thumbnails'),manifestFile=path.join(root,'storage/media.json');await fs.mkdir(directory,{recursive:true});let manifest={version:1,entries:{}};try{manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const bySource=new Map(Object.values(manifest.entries).filter(x=>x.sourceUrl).map(x=>[x.sourceUrl,x]));const fetched=new Map();const errors=[];
 async function exists(relative){if(!/^\.\/thumbnails\/[a-zA-Z0-9_.-]+$/.test(relative||''))return false;try{await fs.stat(path.join(root,'public',relative));return true;}catch{return false;}}
 async function resolve(item){const existing=manifest.entries[item.url],source=item.thumbnailSourceUrl;
  if(existing&&await exists(existing.path)&&(!source||existing.sourceUrl===source))return existing;
  const shared=source&&bySource.get(source);if(shared&&await exists(shared.path))return shared;
  if(!safeImageUrl(source))return null;
  if(!fetched.has(source))fetched.set(source,(async()=>{const image=await limitedImage(await request(source),8*1024*1024);const relative='./thumbnails/'+hash(source)+'.'+image.ext;await fs.writeFile(path.join(root,'public',relative),image.bytes);const record={path:relative,sourceUrl:source,type:item.thumbnailType||'page-image',capturedAt:now,bytes:image.bytes.length};bySource.set(source,record);return record;})());
  try{return await fetched.get(source);}catch(e){errors.push({url:item.url,error:e.message});return null;}
 }
 const items=new Array(library.items.length);let cursor=0;
 async function worker(){while(cursor<library.items.length){const index=cursor++,item=library.items[index];const media=await resolve(item);if(media)manifest.entries[item.url]=media;items[index]={...item,thumbnail:media?.path||null,thumbnailAlt:item.thumbnailAlt||item.title+' 원본 페이지 미리보기',thumbnailType:media?.type||item.thumbnailType||null,thumbnailCapturedAt:media?.capturedAt||null};}}
 await Promise.all([worker(),worker(),worker()]);
 const used=new Set();let size=0;for(const item of items){if(!item.thumbnail)continue;if(used.has(item.thumbnail))continue;let stat;try{stat=await fs.stat(path.join(root,'public',item.thumbnail));}catch{item.thumbnail=null;continue;}if(used.size>=maxFiles||size+stat.size>maxBytes){for(const x of items)if(x.thumbnail===item.thumbnail)x.thumbnail=null;continue;}used.add(item.thumbnail);size+=stat.size;}
 const liveUrls=new Set(items.map(x=>x.url));for(const key of Object.keys(manifest.entries)){if(!liveUrls.has(key)||!used.has(manifest.entries[key].path))delete manifest.entries[key];}
 for(const file of await fs.readdir(directory)){if(!used.has('./thumbnails/'+file))await fs.unlink(path.join(directory,file));}
 manifest.updatedAt=now;await fs.mkdir(path.dirname(manifestFile),{recursive:true});await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));
 return {...library,items,media:{files:used.size,bytes:size,maxFiles,maxBytes,missing:items.filter(x=>!x.thumbnail).length,errors,storage:'cloud-build-assets',updatedAt:now}};
}
module.exports={safeImageUrl,limitedImage,syncMedia};
