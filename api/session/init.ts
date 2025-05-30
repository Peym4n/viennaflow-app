import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';
import dotenvx from '@dotenvx/dotenvx';

// Attempt to configure dotenvx - this might be run on every cold start.
// If your Vercel build process already handles .env.keys for population,
// this explicit call might not be strictly necessary for `dotenvx.get()` to work,
// but it doesn't hurt to ensure it's attempted.
try {
  dotenvx.config();
} catch (e) {
  console.warn('dotenvx.config() failed in /api/session/init.ts, possibly already configured or no .env file found in this context.', e);
}

const UPSTASH_URL = dotenvx.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_TOKEN = dotenvx.get('UPSTASH_REDIS_REST_TOKEN');

let redis: Redis;

if (UPSTASH_URL && UPSTASH_TOKEN) {
  redis = new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,
  });
} else {
  console.error('CRITICAL: Upstash Redis URL or Token is not configured. Redis client not initialized.');
  // Fallback or throw error, so the handler knows redis is not available.
  // For now, the handler will check these vars again and return 500.
}

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN || !redis) {
    console.error('CRITICAL: Upstash Redis environment variables not set or Redis client failed to initialize for /api/session/init handler.');
    return res.status(500).json({ error: 'Server configuration error regarding Redis connection.' });
  }

  try {
    const sessionId = randomBytes(32).toString('hex');
    const sessionSigningKey = randomBytes(64).toString('hex');

    // Store the signing key in Redis, associated with the session ID
    await redis.setex(sessionId, SESSION_TTL_SECONDS, sessionSigningKey);

    // Set the session ID in an HttpOnly cookie
    res.setHeader('Set-Cookie', [
      `sessionId=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    ]);

    // Return the session signing key to the client
    return res.status(200).json({ sessionSigningKey });

  } catch (error) {
    console.error('Error initializing session:', error);
    return res.status(500).json({ error: 'Failed to initialize session.' });
  }
}
