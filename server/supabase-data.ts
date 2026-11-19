import { createClient } from '@supabase/supabase-js';
import { SUPABASE_DATA_SCHEMA } from '../shared/supabase-schema.js';

export function createSupabaseDataClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: SUPABASE_DATA_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
