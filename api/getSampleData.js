import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Initialize Supabase client
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Query your table
  const { data, error } = await supabase
    .from('lines_test') // Replace with your table name
    .select('*'); // Adjust selection if needed

  // Handle errors
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Return data as JSON
  return res.status(200).json(data);
}
