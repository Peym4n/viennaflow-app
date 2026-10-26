import { Redis } from '@upstash/redis';

// Atomic reservation caps per-session bursts and total daily billable elements.
const RESERVE = `
local session = tonumber(redis.call('GET', KEYS[1]) or '0')
local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
if session >= tonumber(ARGV[2]) then return 60 end
if daily + tonumber(ARGV[1]) > tonumber(ARGV[3]) then return 86400 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 60, 'NX')
redis.call('INCRBY', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[2], 172800, 'NX')
return 0`;

function positiveSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid walking usage configuration');
  return value;
}

export async function reserveWalkingUsage(redis: Redis, sessionId: string, elements: number): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  return redis.eval<[number, number, number], number>(RESERVE,
    [`viennaflow:walking:v2:minute:${sessionId}`, `viennaflow:walking:v2:day:${day}`],
    [elements, positiveSetting('WALKING_SESSION_REQUESTS_PER_MINUTE', 10), positiveSetting('WALKING_DAILY_ELEMENT_LIMIT', 2000)],
  );
}
