import type { VercelRequest, VercelResponse } from '@vercel/node';
import { normalizeDiva } from '../../shared/monitor-response.js';
import { DepartureCoordinator, MAX_BATCH } from '../../server/departure-coordinator.js';
import { MemoryDepartureCache, RedisDepartureCache } from '../../server/departure-cache.js';
import { fetchDepartures } from '../../server/departure-provider.js';
import { getAllowedDivas } from '../../server/transit-catalog.js';
import { getRedis } from '../../server/redis.js';
import { environmentMode } from '../../scripts/environment.js';

let memoryCoordinator: DepartureCoordinator | undefined;
function getCoordinator(): DepartureCoordinator {
  const localMemory = process.env['VIENNAFLOW_LOCAL_CACHE'] === 'memory';
  if (localMemory && (environmentMode() !== 'development' || process.env['NODE_ENV'] !== 'development' || process.env['VERCEL'])) {
    throw new Error('Local cache is unavailable in this environment');
  }
  if (localMemory) return memoryCoordinator ??= new DepartureCoordinator(new MemoryDepartureCache(), fetchDepartures);
  return new DepartureCoordinator(new RedisDepartureCache(getRedis()), fetchDepartures);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const started = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body: unknown = req.body;
  const raw = body && typeof body === 'object' && 'divaIds' in body ? body.divaIds : undefined;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_BATCH) {
    res.status(400).json({ error: 'Provide between 1 and 20 station DIVA IDs' });
    return;
  }
  try {
    const ids = raw.map(normalizeDiva);
    const allowed = getAllowedDivas();
    if (ids.some(id => !id || !allowed.has(id))) {
      res.status(400).json({ error: 'Invalid station DIVA IDs' });
      return;
    }
    const response = await getCoordinator().deliver([...new Set(ids as string[])]);
    const statuses = Object.values(response.stations ?? {});
    const pending = statuses.some(station => station.status === 'pending' || station.status === 'error');
    if (process.env['NODE_ENV'] !== 'test') console.info(JSON.stringify({ event: 'departures', stations: ids.length,
      pending: statuses.filter(station => station.status === 'pending').length,
      stale: statuses.filter(station => station.status === 'stale').length,
      failed: statuses.filter(station => station.status === 'error').length,
      oldestCacheAgeMs: Math.max(0, ...statuses.flatMap(station => station.updatedAt ? [Date.now() - station.updatedAt] : [])),
      requestMs: Date.now() - started }));
    if (pending) res.setHeader('Retry-After', '15');
    res.status(response.errorOccurred ? 503 : 200).json(response);
  } catch {
    console.warn('[monitor] Coordination unavailable');
    res.setHeader('Retry-After', '15');
    res.status(503).json({ error: 'Departures are temporarily unavailable', errorOccurred: true });
  }
}
