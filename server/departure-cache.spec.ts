import { Redis } from '@upstash/redis';
import { describe, expect, it, vi } from 'vitest';
import { RedisDepartureCache } from './departure-cache.js';

describe('Redis departure adapter', () => {
  it('normalizes returned numeric members and never treats scores or invalid IDs as pending stations', async () => {
    const redis = { zrange: vi.fn(async () => [60201394, '60201394', '1792963786887', 'invalid']) };
    const cache = new RedisDepartureCache(redis as unknown as Redis);
    expect(await cache.pending(20)).toEqual(['60201394', '60201394']);
    expect(redis.zrange).toHaveBeenCalledWith('viennaflow:departures:v2:pending', 0, 19);
  });

  it('treats invalid cached values as misses while retaining valid empty-station entries', async () => {
    const redis = { mget: vi.fn(async () => [
      { fetchedAt: 123, monitor: null }, { fetchedAt: 'wrong', monitor: {} }, { fetchedAt: 456, monitor: { wrong: true } },
    ]) };
    const cache = new RedisDepartureCache(redis as unknown as Redis);
    expect(await cache.read(['60201394', '60200002', '60200003'])).toEqual([{ fetchedAt: 123, monitor: null }, null, null]);
  });
});
