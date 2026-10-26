import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import dotenvx from '@dotenvx/dotenvx';
import { environmentFile } from '../scripts/environment.js';
import { servePreview } from './static-preview.js';

dotenvx.config({ path: environmentFile(), quiet: true, strict: true });
const preview = process.argv.includes('--preview');
const port = preview ? 4300 : 3000;

// An explicit route table prevents serving arbitrary files as API functions.
const routes = {
  '/api/getLineStops': () => import('../api/getLineStops.js'),
  '/api/getLines': () => import('../api/getLines.js'),
  '/api/getStops': () => import('../api/getStops.js'),
  '/api/getSteige': () => import('../api/getSteige.js'),
  '/api/getNearbySteige': () => import('../api/getNearbySteige.js'),
  '/api/routes/monitor': () => import('../api/routes/monitor.js'),
  '/api/session/init': () => import('../api/session/init.js'),
  '/api/routes/walking-matrix': () => import('../api/routes/walking-matrix.js'),
};

interface LocalRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  body: unknown;
}

interface LocalResponse extends ServerResponse {
  status(code: number): LocalResponse;
  json(body: unknown): void;
  send(body: string): void;
}

createServer(async (request, response) => {
  const req = request as LocalRequest;
  const res = response as LocalResponse;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  res.send = (body) => { res.end(body); };

  try {
    const url = new URL(req.url ?? '/', 'http://localhost:3000');
    if (url.pathname === '/health') return res.json({ status: 'ok' });
    if (preview && !url.pathname.startsWith('/api/')) return servePreview(url.pathname, req.method ?? 'GET', res);
    const load = routes[url.pathname as keyof typeof routes];
    if (!load) return res.status(404).json({ error: 'API route not found' });
    req.query = {};
    for (const name of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(name);
      req.query[name] = values.length === 1 ? values[0] : values;
    }
    req.cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').filter(Boolean).map(cookie => {
      const separator = cookie.indexOf('=');
      return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1))];
    }));
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) return res.status(413).json({ error: 'Request body too large' });
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    try { req.body = body ? JSON.parse(body) : undefined; }
    catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
    const { default: handler } = await load();
    // The deployed functions use several equivalent Vercel request interfaces.
    await (handler as unknown as (req: LocalRequest, res: LocalResponse) => unknown)(req, res);
  } catch {
    console.error('[local-api] Request failed');
    if (!res.headersSent) res.status(500).json({ error: 'Local API request failed' });
    else res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Local ${preview ? 'production preview' : 'API'} ready at http://localhost:${port}`));
