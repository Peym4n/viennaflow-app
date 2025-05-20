import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import { IncomingMessage, ServerResponse } from 'http';

// Define a type for the expected query parameters
interface QueryParams {
  lineid?: string | string[];
}

// Extend IncomingMessage to include query (Vercel/Next.js like structure)
interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

// Helper to send JSON response
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Define a type for the expected data from the 'linien' table (adjust as needed)
interface Linie {
  // Add properties based on your 'linien' table structure
  linien_id: number;
  verkehrsmittel: string;
  name: string;
  // ... other properties
  [key: string]: any; // Allow other properties if schema is not fully defined here
}


export default async function handler(
  req: VercelRequest,
  res: ServerResponse
): Promise<void> {
  const { lineid } = req.query;

  const supabaseUrl = dotenvx.get("SUPABASE_URL");
  const supabaseAnonKey = dotenvx.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or Anon Key is missing for getLines");
    sendJson(res, 500, { error: "Server configuration error" });
    return;
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  let queryBuilder = supabase
    .from("linien")
    .select<string, Linie>("*") // Specify the expected return type
    .eq("verkehrsmittel", "ptMetro");

  if (lineid) {
    const lineIdParam = Array.isArray(lineid) ? lineid[0] : lineid;
    // Assuming linien_id is a number in your DB, parse it
    queryBuilder = queryBuilder.eq("linien_id", parseInt(lineIdParam, 10));
  }

  const { data, error } = await queryBuilder;

  if (error) {
    console.error("Supabase error in getLines:", error);
    sendJson(res, 500, { error: error.message });
    return;
  }

  sendJson(res, 200, data);
} 