import { createClient } from '@supabase/supabase-js';
import { getServerEnv as getEnv } from '../server/environment.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { numericQuery } from '../server/http.js';
import { getAllowedLineIds } from '../server/transit-catalog.js';
import { normalizeNearbyPlatforms } from '../server/nearby-platforms.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const lat = numericQuery(req.query['lat'], -90, 90);
  const lon = numericQuery(req.query['lon'], -180, 180);
  const radius = req.query['radius'] === undefined ? 1000 : numericQuery(req.query['radius'], 1, 5000);
  if (lat === undefined || lon === undefined || radius === undefined || !Number.isInteger(radius)) {
    res.status(400).json({ error: 'Provide valid coordinates and a radius between 1 and 5000 meters' });
    return;
  }
  try {
    const url = getEnv('SUPABASE_URL');
    const key = getEnv('SUPABASE_ANON_KEY');
    if (!url || !key) throw new Error('Nearby provider is not configured');
    const client = createClient(url, key);
    const { data, error } = await client.rpc('get_nearby_steige', { lat, lon, radius }).abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error('Nearby provider unavailable');
    res.status(200).json(normalizeNearbyPlatforms(data, getAllowedLineIds()));
  } catch {
    console.warn('[nearby] Provider unavailable');
    res.status(503).json({ error: 'Nearby stations are temporarily unavailable' });
  }
}
