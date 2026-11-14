'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function versionHtml(html,versions){return html.replace(/\.\/(app\.js|style\.css|favicon\.svg)(?:\?[^"'\s>]*)?/g,(_,file)=>'./'+file+'?v='+versions[file]);}
function main(){const root=path.join(process.cwd(),'public');const versions={};for(const file of ['app.js','style.css','favicon.svg'])versions[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex').slice(0,12);const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const updated=versionHtml(html,versions);fs.writeFileSync(path.join(root,'index.html'),updated);console.log('Browser asset versions updated',versions);}
module.exports={versionHtml};if(require.main===module)main();
