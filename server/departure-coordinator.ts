import { randomUUID } from 'node:crypto';
import { Monitor, MonitorApiResponse, StationMonitorStatus } from '../types/api-models.js';

export const PROVIDER_INTERVAL_MS = 15000;
export const MAX_STALE_MS = 120000;
export const MAX_BATCH = 20;
export interface CachedStation { monitor: Monitor | null; fetchedAt: number; }
export interface DepartureCache {
  read(ids: string[]): Promise<(CachedStation | null)[]>;
  write(entries: Map<string, CachedStation>, token: string): Promise<boolean>;
  enqueue(ids: string[], now: number): Promise<void>;
  pending(limit: number): Promise<string[]>;
  claim(token: string, now: number): Promise<{ acquired: boolean; retryAfterMs: number }>;
  release(token: string): Promise<boolean>;
}

/** No request waits for a rate-limit slot. One lease holder fetches a bounded batch. */
export class DepartureCoordinator {
  constructor(
    private readonly cache: DepartureCache,
    private readonly fetch: (ids: string[]) => Promise<Monitor[]>,
    private readonly now = Date.now,
  ) {}

  async deliver(ids: string[]): Promise<MonitorApiResponse> {
    const entries = new Map<string, CachedStation>();
    let pending = new Set(ids);
    let failed = false;
    let retryAfterMs = PROVIDER_INTERVAL_MS;
    try {
      const cached = await this.cache.read(ids);
      cached.forEach((entry, index) => {
        if (entry && this.now() - entry.fetchedAt < MAX_STALE_MS) entries.set(ids[index], entry);
      });
      pending = new Set(ids.filter(id => !entries.has(id) || this.now() - entries.get(id)!.fetchedAt >= PROVIDER_INTERVAL_MS));
      if (pending.size) {
        await this.cache.enqueue([...pending], this.now());
        const token = randomUUID();
        const lease = await this.cache.claim(token, this.now());
        retryAfterMs = lease.retryAfterMs;
        if (lease.acquired) {
          try {
            const queued = await this.cache.pending(MAX_BATCH);
            const batch = [...new Set([...pending, ...queued])].slice(0, MAX_BATCH);
            const monitors = await this.fetch(batch);
            const fetchedAt = this.now();
            const fresh = new Map<string, CachedStation>();
            for (const id of batch) {
              const matching = monitors.filter(monitor => monitor.locationStop.properties.name === id);
              fresh.set(id, {
                fetchedAt,
                monitor: matching.length ? { ...matching[0], lines: matching.flatMap(monitor => monitor.lines) } : null,
              });
            }
            if (!await this.cache.write(fresh, token)) throw new Error('Departure lease expired');
            for (const id of ids) {
              if (fresh.has(id)) { entries.set(id, fresh.get(id)!); pending.delete(id); }
            }
          } finally {
            // Compare-and-delete prevents releasing a replacement owner's lease.
            await this.cache.release(token);
          }
        }
      }
    } catch {
      failed = true;
    }

    const stations: Record<string, StationMonitorStatus> = {};
    const monitors: Monitor[] = [];
    for (const id of ids) {
      const entry = entries.get(id);
      if (entry?.monitor) monitors.push(entry.monitor);
      stations[id] = {
        status: pending.has(id) ? (entry ? 'stale' : failed ? 'error' : 'pending') : entry?.monitor ? 'data' : 'empty',
        updatedAt: entry?.fetchedAt,
        ...(pending.has(id) ? { retryAfterMs: Math.max(retryAfterMs, 1000) } : {}),
      };
    }
    return {
      data: { monitors }, stations, timestamp: this.now(),
      errorOccurred: failed && !entries.size,
      message: { value: failed ? 'Departure delivery is temporarily unavailable' : 'Departures', messageCode: 1, serverTime: new Date(this.now()).toISOString() },
    };
  }
}
