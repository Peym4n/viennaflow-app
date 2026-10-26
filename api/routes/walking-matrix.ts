import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServerEnv as getEnv } from '../../server/environment.js';
import { getRedis } from '../../server/redis.js';
import { getSigningKeys, validSessionId } from '../../server/signing-session.js';
import { fetchWalkingMatrix, validateWalkingPayload, verifySignature } from '../../server/walking.js';
import { reserveWalkingUsage } from '../../server/walking-limits.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body: unknown = req.body;
  if (!validateWalkingPayload(body)) {
    res.status(400).json({ error: 'Provide one valid origin and between 1 and 25 valid destinations' });
    return;
  }
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  const sessionId = req.cookies?.['sessionId'];
  if (!validSessionId(sessionId) || typeof timestamp !== 'string' || typeof signature !== 'string') {
    res.status(401).json({ error: 'Walking session must be renewed' });
    return;
  }
  let keys: string[];
  try {
    const redis = getRedis();
    keys = await getSigningKeys(redis, sessionId);
    if (!keys.some(key => verifySignature(key, body, timestamp, signature))) {
      res.status(401).json({ error: 'Walking session must be renewed' });
      return;
    }
    const retryAfter = await reserveWalkingUsage(redis, sessionId, body.destinations.length);
    if (retryAfter) {
      if (process.env['NODE_ENV'] !== 'test') console.info(JSON.stringify({ event: 'walking', outcome: 'rate_limited', destinations: body.destinations.length }));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Walking estimates are temporarily unavailable. Please try again later.' });
      return;
    }
  } catch {
    console.warn('[walking] Session or usage service unavailable');
    res.status(503).json({ error: 'Walking estimates are temporarily unavailable' });
    return;
  }
  try {
    const apiKey = getEnv('GOOGLE_MAPS_SERVER_API_KEY');
    if (!apiKey) throw new Error('Walking provider is not configured');
    const started = Date.now();
    const matrix = await fetchWalkingMatrix(body, apiKey);
    if (process.env['NODE_ENV'] !== 'test') console.info(JSON.stringify({ event: 'walking', outcome: 'delivered',
      destinations: body.destinations.length, successful: matrix.rows[0].elements.filter(element => element.status === 'OK').length,
      providerMs: Date.now() - started }));
    res.status(200).json(matrix);
  } catch {
    console.warn('[walking] Provider unavailable');
    res.status(502).json({ error: 'Walking estimates could not be loaded' });
  }
}
