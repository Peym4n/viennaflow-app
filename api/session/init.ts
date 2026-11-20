import type { ApiRequest, ApiResponse } from '../../server/http.js';
import { getRedis } from '../../server/redis.js';
import { initializeSigningSession } from '../../server/signing-session.js';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const session = await initializeSigningSession(getRedis(), req.cookies?.['sessionId']);
    res.setHeader('Set-Cookie', `sessionId=${session.id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${session.maxAge}`);
    res.status(200).json({ sessionSigningKey: session.key, expiresAt: session.expiresAt });
  } catch {
    console.warn('[session] Initialization unavailable');
    res.setHeader('Retry-After', '30');
    res.status(503).json({ error: 'Walking session is temporarily unavailable' });
  }
}
