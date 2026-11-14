'use strict';
const fs=require('node:fs');const data=JSON.parse(fs.readFileSync('public/data/library.json','utf8'));let manifest={entries:{}};try{manifest=JSON.parse(fs.readFileSync('storage/media.json','utf8'));}catch{}
const missing=data.items.some(x=>!x.thumbnail),large=Object.values(manifest.entries).some(x=>x.bytes>180000&&x.type!=='page-screenshot'&&!x.optimized),needed=missing||large;
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'needed='+needed+'\n');console.log(JSON.stringify({needed,missing,large}));
