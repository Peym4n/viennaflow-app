import { readFile, stat } from 'node:fs/promises';
import { ServerResponse } from 'node:http';
import path from 'node:path';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

/** Static production-preview serving only; Vercel continues to own deployed routing. */
export async function servePreview(pathname: string, method: string, response: ServerResponse,
  root = path.resolve('dist/viennaflow-app/browser')): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let requested: string;
  try { requested = decodeURIComponent(pathname); } catch { response.writeHead(400); response.end(); return; }
  const filename = path.resolve(root, '.' + requested);
  const relative = path.relative(root, filename);
  if (requested.includes('\0') || relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(404); response.end(); return;
  }
  let target = filename;
  try { if (!(await stat(target)).isFile()) target = path.join(root, 'index.html'); }
  catch {
    if (path.extname(requested)) { response.writeHead(404); response.end(); return; }
    target = path.join(root, 'index.html');
  }
  try {
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
    response.end(method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(503); response.end('Build the application before starting preview.'); }
}
