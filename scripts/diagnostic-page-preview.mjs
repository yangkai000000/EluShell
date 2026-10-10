import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('artifacts/mac-diagnostic-0.9.1/site');
const server = createServer(async (req, res) => {
  try {
    let target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (target !== root && !target.startsWith(root + path.sep)) throw Error('Invalid path');
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    let data = await readFile(target);
    if (target.endsWith('.html')) data = Buffer.from(data.toString().replaceAll('__RELEASE_TEXT_091__', '2026-09-14（待发布）'));
    res.setHeader('Content-Type', target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(18891, '127.0.0.1', () => console.log('Diagnostic download-page preview: http://127.0.0.1:18891/'));
