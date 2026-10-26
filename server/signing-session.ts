import { randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';

export const SESSION_TTL_SECONDS = 86400;
const prefix = 'viennaflow:signing:v2:';
export const validSessionId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

export async function getSigningKeys(redis: Redis, id: string): Promise<string[]> {
  // Accept existing installed clients for their remaining original 24-hour lifetime.
  const keys = await redis.mget<(string | null)[]>(prefix + id, id);
  return keys.filter((key): key is string => typeof key === 'string');
}

export async function initializeSigningSession(redis: Redis, cookie?: string) {
  const id = validSessionId(cookie) ? cookie : randomBytes(32).toString('hex');
  const storageKey = prefix + id;
  let key = await redis.get<string>(storageKey);
  if (!key) {
    // NX plus reread lets concurrent tabs recover the same expired cookie safely.
    await redis.set(storageKey, randomBytes(64).toString('hex'), { nx: true, ex: SESSION_TTL_SECONDS });
    key = await redis.get<string>(storageKey);
  }
  if (!key) throw new Error('Signing session unavailable');
  const ttl = await redis.ttl(storageKey);
  if (ttl <= 0) throw new Error('Signing session expired during initialization');
  return { id, key, expiresAt: Date.now() + ttl * 1000, maxAge: ttl };
}
