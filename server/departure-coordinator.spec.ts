import { describe, expect, it, vi } from 'vitest';
import { DepartureCoordinator } from './departure-coordinator.js';
import { MemoryDepartureCache } from './departure-cache.js';
import { normalizeMonitorResponse } from '../shared/monitor-response.js';
import fixture from '../api/monitor-u6-sample.json' with { type: 'json' };

const monitors = normalizeMonitorResponse(fixture).data!.monitors;
const diva = '60201394';

describe('departure coordination', () => {
  it('shares one provider slot across concurrent callers and preserves accurate cache age', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    let complete!: (value: typeof monitors) => void;
    const fetch = vi.fn(() => new Promise<typeof monitors>(resolve => { complete = resolve; }));
    const first = new DepartureCoordinator(cache, fetch, () => now);
    const second = new DepartureCoordinator(cache, fetch, () => now);
    const firstRequest = first.deliver([diva]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const waiting = await second.deliver([diva]);
    expect(waiting.stations![diva].status).toBe('pending');
    complete(monitors);
    const loaded = await firstRequest;
    expect(loaded.stations![diva]).toEqual({ status: 'data', updatedAt: now });
    now += 10000;
    const cached = await second.deliver([diva]);
    expect(cached.stations![diva].updatedAt).toBe(100000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns only requested stations, batches pending IDs without scores, and caches valid empty data', async () => {
    let now = 0;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn(async (_ids: string[]) => monitors);
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    await coordinator.deliver([diva]);
    expect((await coordinator.deliver(['60200002'])).stations!['60200002'].status).toBe('pending');
    now = 15000;
    const empty = await coordinator.deliver(['60200002']);
    expect(empty.stations!['60200002'].status).toBe('empty');
    expect(empty.data!.monitors).toEqual([]);
    expect(fetch.mock.calls.at(-1)![0]).toEqual(['60200002']);
    await coordinator.deliver(['60200002']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns bounded stale data on provider failure and never bypasses failed coordination', async () => {
    let now = 0;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn().mockResolvedValueOnce(monitors).mockRejectedValue(new Error('provider failed'));
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    await coordinator.deliver([diva]);
    now = 15000;
    const stale = await coordinator.deliver([diva]);
    expect(stale.stations![diva]).toMatchObject({ status: 'stale', updatedAt: 0 });
    now = 120001;
    expect((await coordinator.deliver([diva])).stations![diva].status).toBe('error');
    vi.spyOn(cache, 'read').mockRejectedValue(new Error('Redis unavailable'));
    const before = fetch.mock.calls.length;
    expect((await coordinator.deliver([diva])).errorOccurred).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(before);
  });

  it('expires abandoned leases, retains the 15-second gate, and compares lease ownership', async () => {
    const cache = new MemoryDepartureCache();
    expect((await cache.claim('first', 0)).acquired).toBe(true);
    expect((await cache.claim('second', 12001)).acquired).toBe(false);
    expect((await cache.claim('second', 15000)).acquired).toBe(true);
    expect(await cache.release('first')).toBe(false);
    expect((await cache.claim('third', 30000)).acquired).toBe(true);
  });

  it('prevents an expired owner from overwriting a replacement owner cache', async () => {
    let now = 0;
    const cache = new MemoryDepartureCache(() => now);
    await cache.claim('old', now);
    now = 15000;
    await cache.claim('new', now);
    const entries = new Map([[diva, { monitor: monitors[0], fetchedAt: now }]]);
    expect(await cache.write(entries, 'old')).toBe(false);
    expect(await cache.read([diva])).toEqual([null]);
    expect(await cache.write(entries, 'new')).toBe(true);
    expect((await cache.read([diva]))[0]!.fetchedAt).toBe(now);
  });
});
