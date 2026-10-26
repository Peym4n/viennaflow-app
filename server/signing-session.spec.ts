import { Redis } from '@upstash/redis';
import { describe, expect, it, vi } from 'vitest';
import { getSigningKeys, initializeSigningSession } from './signing-session.js';

function memoryRedis() {
  const values = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    mget: vi.fn(async (...keys: string[]) => keys.map(key => values.get(key) ?? null)),
    set: vi.fn(async (key: string, value: string, _options: { nx: boolean; ex: number }) => { if (!values.has(key)) values.set(key, value); }),
    ttl: vi.fn(async () => 86000),
  };
  return { values, client, redis: client as unknown as Redis };
}

describe('signing-session renewal', () => {
  it('reuses one key for concurrent tabs with the same cookie', async () => {
    const { redis, client } = memoryRedis();
    const id = 'a'.repeat(64);
    const [first, second] = await Promise.all([initializeSigningSession(redis, id), initializeSigningSession(redis, id)]);
    expect(first.id).toBe(id);
    expect(first.key).toBe(second.key);
    expect(client.set.mock.calls[0][2]).toEqual({ nx: true, ex: 86400 });
    const third = await initializeSigningSession(redis, id);
    expect(third.key).toBe(first.key);
    expect(client.set).toHaveBeenCalledTimes(2);
  });

  it('renews an expired cookie and accepts a still-valid installed client key during migration', async () => {
    const { redis, values } = memoryRedis();
    const id = 'b'.repeat(64);
    values.set(id, 'legacy-key');
    const session = await initializeSigningSession(redis, id);
    expect(await getSigningKeys(redis, id)).toEqual([session.key, 'legacy-key']);
    values.delete('viennaflow:signing:v2:' + id);
    values.delete(id);
    const renewed = await initializeSigningSession(redis, id);
    expect(renewed.id).toBe(id);
    expect(renewed.key).not.toBe(session.key);
  });
});
