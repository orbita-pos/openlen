import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('templates/starter');
const types = {'.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.js':'text/javascript'};
http.createServer((req,res)=>{
  let p = decodeURIComponent((req.url||'/').split('?')[0]);
  if(p==='/'||p==='') p='/aetherborn.preview.html';
  const f = path.join(root, p);
  if(!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){res.writeHead(404);res.end('404');return;}
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});
  fs.createReadStream(f).pipe(res);
}).listen(8777,()=>console.log('serving templates/starter at http://localhost:8777/'));
