import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import { IncomingMessage, ServerResponse } from 'http';
import { GeoJsonPoint, RawNearbySteig, NearbySteig } from '@shared-types/api-models';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define a type for the expected query parameters to make it cleaner
interface QueryParams {
  lat?: string | string[];
  lon?: string | string[];
  radius?: string | string[];
}

// Interface for the structure of lineStops.json
interface LineStopsData {
  lines: {
    [lineId: string]: any; // We only care about the keys (line IDs)
  };
}

// Extend IncomingMessage to include query (Vercel/Next.js like structure)
interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

// Helper to send JSON response, mimicking res.json()
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Function to read and get allowed line IDs from lineStops.json
function getAllowedLinienIds(): number[] {
  try {
    // ESM-compatible way to get __dirname
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Resolve path relative to the current file in the api directory
    const filePath = path.resolve(__dirname, 'lineStops.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const jsonData: LineStopsData = JSON.parse(fileContent);
    if (jsonData && jsonData.lines) {
      return Object.keys(jsonData.lines).map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    }
    console.warn("Could not parse line IDs from lineStops.json or 'lines' property missing.");
    return [];
  } catch (error) {
    console.error("Error reading or parsing lineStops.json:", error);
    return []; // Return empty array on error to avoid breaking the main logic
  }
}

export default async function handler(
  req: VercelRequest,       // Using our extended VercelRequest
  res: ServerResponse       // Standard Node.js ServerResponse
): Promise<void> {

  const { lat, lon, radius } = req.query;

  if (!lat || !lon) {
    sendJson(res, 400, { error: "Latitude and longitude are required." });
    return;
  }

  const latitude = Array.isArray(lat) ? lat[0] : lat;
  const longitude = Array.isArray(lon) ? lon[0] : lon;
  const radiusParam = Array.isArray(radius) ? radius[0] : radius;

  const supabaseUrl = dotenvx.get("SUPABASE_URL");
  const supabaseAnonKey = dotenvx.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or Anon Key is missing!!!");
    sendJson(res, 500, { error: "Server configuration error!!" });
    return;
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data: rawData, error } = await supabase.rpc("get_nearby_steige", {
      lat: parseFloat(latitude as string),
      lon: parseFloat(longitude as string),
      radius: radiusParam ? parseInt(radiusParam as string, 10) : 1000,
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      sendJson(res, 500, { error: error.message });
      return;
    }

    if (!Array.isArray(rawData)) {
      console.error("Supabase RPC data is not an array:", rawData);
      sendJson(res, 500, { error: "Invalid data format from database." });
      return;
    }
    
    const allowedLinienIds = getAllowedLinienIds();
    console.log("allowedLinienIds: ", allowedLinienIds);
    if (allowedLinienIds.length === 0) {
      console.warn("No allowed line IDs found in lineStops.json. Returning all nearby Steige or consider it an error.");
    }

    const processedAndFilteredData: NearbySteig[] = rawData
      .map((item: RawNearbySteig): NearbySteig => {
        let parsedLocation: GeoJsonPoint;
        try {
          if (typeof item.location !== 'string') {
            throw new Error('Location is not a string');
          }
          parsedLocation = JSON.parse(item.location);
        } catch (parseError) {
          console.error("Failed to parse location string:", item.location, parseError);
          parsedLocation = { type: "Point", coordinates: [0, 0] }; // Default/error state
        }

        const fkLinienIdNum = typeof item.fk_linien_id === 'string' ? parseInt(item.fk_linien_id, 10) : item.fk_linien_id;

        // Destructure item to separate transformed properties from the rest
        // Expect 'haltestellen_diva' (plural) from RawNearbySteig (item)
        const { location, fk_linien_id, haltestellen_diva, ...restOfItem } = item;

        return {
          ...restOfItem,
          location: parsedLocation,
          fk_linien_id: fkLinienIdNum,
          // Use haltestellen_diva consistently, converting null to 0
          haltestellen_diva: haltestellen_diva == null ? 0 : haltestellen_diva,
        };
      })
      .filter((steig: NearbySteig) => {
        return allowedLinienIds.includes(steig.fk_linien_id);
      });

    sendJson(res, 200, processedAndFilteredData);
  } catch (e) {
    console.error("Unexpected error in getNearbySteige:", e);
    const message = e instanceof Error ? e.message : "An unexpected error occurred.";
    sendJson(res, 500, { error: message });
  }
} 