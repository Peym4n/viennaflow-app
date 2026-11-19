import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServerEnv } from '../../server/environment.js';
import { createSupabaseDataClient } from '../../server/supabase-data.js';

const transitTables = [
  { table: 'linien', id: 'linien_id' },
  { table: 'haltestellen', id: 'haltestellen_id' },
  { table: 'steige', id: 'steig_id' },
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env['CRON_SECRET'];
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const url = getServerEnv('SUPABASE_URL');
    const key = getServerEnv('SUPABASE_ANON_KEY');
    if (!url || !key) throw new Error('Supabase is not configured');

    const client = createSupabaseDataClient(url, key);
    const signal = AbortSignal.timeout(8000);
    const results = await Promise.all(transitTables.map(({ table, id }) =>
      client.from(table).select(id).limit(1).abortSignal(signal),
    ));
    if (results.some(result => result.error)) throw new Error('Supabase transit read failed');

    res.status(200).json({ status: 'ok' });
  } catch {
    console.warn('[supabase-keepalive] Transit read failed');
    res.status(503).json({ error: 'Supabase check temporarily unavailable' });
  }
}
