import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../tizen/',import.meta.url));
http.createServer(async(req,res)=>{
  const filename=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!filename.startsWith(root)){res.writeHead(403).end();return;}
  try {const data=await readFile(filename);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'text/plain');res.end(data);}
  catch {res.writeHead(404).end();}
}).listen(8093,'127.0.0.1',()=>console.log('TV preview: http://127.0.0.1:8093'));
