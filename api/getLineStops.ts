import { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, validIdQuery } from '../server/http.js';
import { getCatalog } from '../server/transit-catalog.js';

interface CatalogRequest extends IncomingMessage { query: { linien_id?: string | string[] }; }

export default function handler(req: CatalogRequest, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!validIdQuery(req.query.linien_id, true)) {
    sendJson(res, 400, { error: 'Invalid query IDs' });
    return;
  }
  try {
    const catalog = getCatalog();
    const ids = typeof req.query.linien_id === 'string' ? req.query.linien_id.split(',').map(id => id.trim()) : null;
    const lines = ids ? Object.fromEntries(Object.entries(catalog.lines).filter(([id]) => ids.includes(id))) : catalog.lines;
    sendJson(res, 200, { metainfo: catalog.metainfo, lines });
  } catch {
    console.warn('[catalog] Transit catalog unavailable');
    sendJson(res, 500, { error: 'Transit data could not be loaded' });
  }
}
