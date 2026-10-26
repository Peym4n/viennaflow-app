import { Redis } from '@upstash/redis';
import { CachedStation, DepartureCache, MAX_STALE_MS, PROVIDER_INTERVAL_MS } from './departure-coordinator.js';
import { normalizeDiva, normalizeMonitorResponse } from '../shared/monitor-response.js';
import { getAllowedDivas } from './transit-catalog.js';

const PREFIX = 'viennaflow:departures:v2:';
const QUEUE = PREFIX + 'pending';
const LOCK = PREFIX + 'lease';
const LAST = PREFIX + 'last-provider-request';
const CLAIM = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local remaining = tonumber(ARGV[2]) - (now - last)
if remaining > 0 then return {0, remaining} end
if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', 12000) then return {0, 1000} end
redis.call('SET', KEYS[2], now, 'EX', 86400)
return {1, 0}`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
const WRITE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
for i = 3, #KEYS do
  local offset = (i - 3) * 2 + 3
  redis.call('SET', KEYS[i], ARGV[offset + 1], 'EX', ARGV[2])
  redis.call('ZREM', KEYS[2], ARGV[offset])
end
return 1`;

export class RedisDepartureCache implements DepartureCache {
  constructor(private readonly redis: Redis) {}
  async read(ids: string[]): Promise<(CachedStation | null)[]> {
    const values = await this.redis.mget<unknown[]>(...ids.map(id => PREFIX + id));
    return values.map((value, index) => {
      if (!value || typeof value !== 'object' || !('fetchedAt' in value) || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || !('monitor' in value)) return null;
      if (value.monitor === null) return { fetchedAt: value.fetchedAt, monitor: null };
      try {
        const monitor = normalizeMonitorResponse({ data: { monitors: [value.monitor] } }).data!.monitors[0];
        return monitor.locationStop.properties.name === ids[index] ? { fetchedAt: value.fetchedAt, monitor } : null;
      } catch { return null; }
    });
  }
  async write(entries: Map<string, CachedStation>, token: string): Promise<boolean> {
    const keys = [LOCK, QUEUE, ...[...entries.keys()].map(id => PREFIX + id)];
    const args: (string | number)[] = [token, MAX_STALE_MS / 1000];
    for (const [id, entry] of entries) args.push(id, JSON.stringify(entry));
    return await this.redis.eval<(string | number)[], number>(WRITE, keys, args) === 1;
  }
  async enqueue(ids: string[], now: number): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.zadd(QUEUE, { nx: true }, { score: now, member: id });
    pipeline.expire(QUEUE, MAX_STALE_MS / 1000);
    await pipeline.exec();
  }
  async pending(limit: number) {
    const ids = await this.redis.zrange<(string | number)[]>(QUEUE, 0, limit - 1);
    const allowed = getAllowedDivas();
    return ids.map(normalizeDiva).filter((id): id is string => !!id && allowed.has(id));
  }
  async claim(token: string, _now: number) {
    const [acquired, retryAfterMs] = await this.redis.eval<[string, number], [number, number]>(CLAIM, [LOCK, LAST], [token, PROVIDER_INTERVAL_MS]);
    return { acquired: acquired === 1, retryAfterMs };
  }
  async release(token: string): Promise<boolean> { return await this.redis.eval<[string], number>(RELEASE, [LOCK], [token]) === 1; }
}

/** Explicit development/test adapter; never a production failover. */
export class MemoryDepartureCache implements DepartureCache {
  private readonly entries = new Map<string, CachedStation>();
  private readonly queue = new Map<string, number>();
  private lastRequest = -Infinity;
  private lease: { token: string; expiresAt: number } | null = null;
  constructor(private readonly now = Date.now) {}
  async read(ids: string[]) { return ids.map(id => {
    const entry = this.entries.get(id);
    if (entry && this.now() - entry.fetchedAt < MAX_STALE_MS) return entry;
    this.entries.delete(id);
    return null;
  }); }
  async write(entries: Map<string, CachedStation>, token: string) {
    if (this.lease?.token !== token || this.lease.expiresAt <= this.now()) return false;
    for (const [id, entry] of entries) { this.entries.set(id, entry); this.queue.delete(id); }
    return true;
  }
  async enqueue(ids: string[], now: number) { for (const id of ids) if (!this.queue.has(id)) this.queue.set(id, now); }
  async pending(limit: number) { return [...this.queue].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id); }
  async claim(token: string, now: number) {
    const remaining = PROVIDER_INTERVAL_MS - (now - this.lastRequest);
    if (remaining > 0) return { acquired: false, retryAfterMs: remaining };
    if (this.lease && this.lease.expiresAt > now) return { acquired: false, retryAfterMs: 1000 };
    this.lease = { token, expiresAt: now + 12000 };
    this.lastRequest = now;
    return { acquired: true, retryAfterMs: 0 };
  }
  async release(token: string) {
    if (this.lease?.token !== token) return false;
    this.lease = null;
    return true;
  }
}
