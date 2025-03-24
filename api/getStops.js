import { createClient } from '@supabase/supabase-js';
import * as dotenvx from '@dotenvx/dotenvx';

export default async function handler(req, res) {
  // Initialize Supabase client
  const supabase = createClient(
    dotenvx.get('SUPABASE_URL'),
    dotenvx.get('SUPABASE_ANON_KEY')
  );

  // Query your table
  const { data, error } = await supabase
    .from('haltestellen') // Tabell name
    .select('*'); // What to select

  // Handle errors
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Return Stops as JSON
  return res.status(200).json(data);
}
