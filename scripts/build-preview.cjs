'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const base = path.resolve(__dirname, '..');
const publicDir = path.join(base, 'public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');
const mime = { '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif' };
function localDataURL(url, kind) {
  const normalized = url.replace(/^\.\//, '');
  if (!normalized.startsWith(kind + '/') || normalized.split('/').includes('..')) throw new Error('Unsafe preview asset path: ' + url);
  const file = path.resolve(publicDir, normalized);
  if (!file.startsWith(publicDir + path.sep)) throw new Error('Preview asset escapes public directory: ' + url);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) { throw new Error('Missing preview asset: ' + file + '. Add the real font/thumbnail asset before building. ' + error.message); }
  const type = mime[path.extname(file).toLowerCase()];
  if (!type || !bytes.length) throw new Error('Unsupported or empty preview asset: ' + file);
  return 'data:' + type + ';base64,' + bytes.toString('base64');
}
function remoteImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || redirects > 4) return reject(new Error('Unsafe thumbnail URL: ' + url));
    const request = https.get(parsed, { headers: { 'User-Agent': 'Moa-offline-preview/1.0', Accept: 'image/*' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); return resolve(remoteImage(new URL(response.headers.location, url).href, redirects + 1)); }
      const type = (response.headers['content-type'] || '').split(';')[0].trim();
      if (response.statusCode !== 200 || !/^image\/(webp|png|jpeg|gif|avif)$/.test(type)) { response.resume(); return reject(new Error('Cannot embed thumbnail ' + url + ': HTTP ' + response.statusCode + ', ' + type)); }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 20 * 1024 * 1024) response.destroy(new Error('Thumbnail exceeds 20 MB: ' + url)); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => size ? resolve('data:' + type + ';base64,' + Buffer.concat(chunks).toString('base64')) : reject(new Error('Empty thumbnail: ' + url)));
    });
    request.setTimeout(20000, () => request.destroy(new Error('Thumbnail download timed out: ' + url)));
    request.on('error', reject);
  });
}
async function main() {
  let html = read('index.html');
  let css = read('style.css');
  const js = read('app.js');
  const library = JSON.parse(read('data/library.json'));
  // Server CSP must permit font-src 'self' and img-src 'self' https: for live remote thumbnails.
  // The standalone preview has no font/image network dependencies.
  css = css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_, quote, url) => {
    if (url.startsWith('data:')) return 'url("' + url + '")';
    if (!/^\.\/fonts\//.test(url)) throw new Error('Unexpected external or unsupported CSS asset: ' + url);
    return 'url("' + localDataURL(url, 'fonts') + '")';
  });
  const imageCache = new Map(); const embeddedImages={}; let thumbnailCount = 0;
  for (const item of library.items) {
    if (!item.thumbnail) continue;
    const url = item.thumbnail;
    if (!imageCache.has(url)) {
      if (/^\.\/thumbnails\//.test(url)) imageCache.set(url, localDataURL(url, 'thumbnails'));
      else if (/^https:\/\//.test(url)) imageCache.set(url, await remoteImage(url));
      else throw new Error('Unsupported thumbnail path for ' + item.id + ': ' + url);
    }
    const imageKey='preview-image:'+([...imageCache.keys()].indexOf(url));embeddedImages[imageKey]=imageCache.get(url);item.thumbnail=imageKey;thumbnailCount++;
  }
  const data = JSON.stringify(library).replace(/</g, '\\u003c');
  html = html.replace('<link rel="stylesheet" href="./style.css">', () => '<style>' + css + '</style>').replace('<script defer src="./app.js"></script>', '').replace('<a class="brand" href="./"', '<a class="brand" href="#main"');
  html = html.replace('사이트형 · 배포 전 미리보기', '사이트형 · 오프라인 스냅샷 (배포 전)');
  html = html.replace('</body>', () => '<script id="embedded-images" type="application/json">'+JSON.stringify(embeddedImages).replace(/</g,'\\u003c')+'</script><script id="embedded-library" type="application/json">' + data + '</script><script>' + js.replace(/<\/script/gi, '<\\/script') + '</script></body>');
  fs.writeFileSync(path.join(base, 'preview.html'), html);
  console.log('Built offline preview: ' + Buffer.byteLength(html) + ' bytes; ' + thumbnailCount + ' thumbnails (' + imageCache.size + ' unique), local Pretendard embedded.');
}
main().catch(error => { console.error('Preview build failed: ' + error.message); process.exitCode = 1; });
