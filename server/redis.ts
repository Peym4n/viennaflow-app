import { Redis } from '@upstash/redis';
import { getServerEnv as getEnv } from './environment.js';

export function getRedis(): Redis {
  const url = getEnv('UPSTASH_REDIS_REST_URL');
  const token = getEnv('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) throw new Error('Redis is not configured');
  // Preserve actual Redis errors, including service quotas, instead of pipeline-shape errors.
  // A request owns its deadline; never reuse an expired signal in another handler.
  return new Redis({ url, token, enableAutoPipelining: false, retry: false, signal: AbortSignal.timeout(12000) });
}
