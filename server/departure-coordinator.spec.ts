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
    expect(loaded.stations![diva]).toEqual({ status: 'data', updatedAt: now, ageMs: 0 });
    now += 10000;
    const cached = await second.deliver([diva]);
    expect(cached.stations![diva].updatedAt).toBe(100000);
    expect(cached.stations![diva].ageMs).toBe(10000);
    expect(cached.nextPollInMs).toBe(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the remaining cooldown for a station selected five seconds after another', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn(async (_ids: string[]) => monitors);
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    await coordinator.deliver([diva]);
    now += 5000;
    const pending = await coordinator.deliver(['60200002']);
    expect(pending.nextPollInMs).toBe(10000);
    expect(pending.stations!['60200002']).toMatchObject({ status: 'pending', retryAfterMs: 10000 });
    now += pending.nextPollInMs!;
    await coordinator.deliver(['60200002']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('guides a cached response to its expiry instead of skipping an entire polling cycle', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn(async () => { now += 1000; return monitors; });
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    const first = await coordinator.deliver([diva]);
    expect(first.nextPollInMs).toBe(15000);
    now = 115000;
    const cached = await coordinator.deliver([diva]);
    expect(cached.nextPollInMs).toBe(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += cached.nextPollInMs!;
    await coordinator.deliver([diva]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lets concurrent callers recheck the cache while an owned provider request is running', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    let complete!: (value: typeof monitors) => void;
    const fetch = vi.fn(() => new Promise<typeof monitors>(resolve => { complete = resolve; }));
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    const first = coordinator.deliver([diva]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const pending = await coordinator.deliver([diva]);
    expect(pending.nextPollInMs).toBe(1000);
    now += 500;
    complete(monitors); await first;
    now += 500;
    const cached = await coordinator.deliver([diva]);
    expect(cached.stations![diva].status).toBe('data');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('warms queued stations in another caller\'s batch without returning unrequested data', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn(async (_ids: string[]) => monitors);
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    await coordinator.deliver([diva]);
    now += 5000;
    await coordinator.deliver(['60200002']);
    now += 10000;
    const foreground = await coordinator.deliver([diva]);
    expect(fetch.mock.calls.at(-1)![0]).toEqual([diva, '60200002']);
    expect(Object.keys(foreground.stations!)).toEqual([diva]);
    expect((await coordinator.deliver(['60200002'])).stations!['60200002'].status).toBe('empty');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains the cooldown after a provider failure and marks stale snapshots as failed refreshes', async () => {
    let now = 100000;
    const cache = new MemoryDepartureCache(() => now);
    const fetch = vi.fn().mockResolvedValueOnce(monitors).mockImplementation(async () => { now += 2000; throw new Error('failed'); });
    const coordinator = new DepartureCoordinator(cache, fetch, () => now);
    await coordinator.deliver([diva]);
    now += 15000;
    const failure = await coordinator.deliver([diva]);
    expect(failure.errorOccurred).toBe(true);
    expect(failure.stations![diva].status).toBe('stale');
    expect(failure.nextPollInMs).toBe(13000);
    expect(failure.stations![diva].retryAfterMs).toBe(13000);
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
