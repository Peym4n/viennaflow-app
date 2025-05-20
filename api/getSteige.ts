import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import wkx from "wkx";
import { IncomingMessage, ServerResponse } from 'http';

// --- Common Vercel Request/Response Types ---
interface QueryParams {
  stopid?: string | string[];
}

interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// --- GeoJSON Basic Types (simplified, reuse if defined elsewhere) ---
interface GeoJsonGeometry { // A generic GeoJSON geometry type
  type: string; // e.g., "Point", "LineString", "Polygon"
  coordinates: any; // Coordinates structure varies by type
}

interface GeoJsonFeature<G extends GeoJsonGeometry, P> {
  type: "Feature";
  geometry: G;
  properties: P;
}

interface GeoJsonFeatureCollection<G extends GeoJsonGeometry, P> {
  type: "FeatureCollection";
  features: Array<GeoJsonFeature<G, P>>;
}

// --- Specific types for 'steige' table and its properties ---
interface SteigDataFromDB {
  location: string; // WKB string from database
  steig_id: number;
  fk_linien_id: number;
  fk_haltestellen_id: number;
  richtung: string;
  reihenfolge: number;
  rbl_nummer: number | null; // Assuming rbl_nummer can be null
  bereich: number | null;    // Assuming bereich can be null
  steig: string | null;       // Assuming steig can be null
  [key: string]: any; // Allow other properties
}

interface SteigProperties {
  steig_id: number;
  fk_linien_id: number;
  fk_haltestellen_id: number;
  richtung: string;
  reihenfolge: number;
  rbl_nummer: number | null;
  bereich: number | null;
  steig: string | null;
}

type SteigGeoJsonFeature = GeoJsonFeature<GeoJsonGeometry, SteigProperties>; // Geometry is generic from wkx
type SteigFeatureCollection = GeoJsonFeatureCollection<GeoJsonGeometry, SteigProperties>;


export default async function handler(
  req: VercelRequest,
  res: ServerResponse
): Promise<void> {
  const { stopid } = req.query;
  // console.log("API getSteige called with stopid:", stopid); // More descriptive log

  const stopIdParam = Array.isArray(stopid) ? stopid[0] : stopid;

  if (!stopIdParam) {
    sendJson(res, 400, { error: "stopid is mandatory" });
    return;
  }

  const supabaseUrl = dotenvx.get("SUPABASE_URL");
  const supabaseAnonKey = dotenvx.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or Anon Key is missing for getSteige");
    sendJson(res, 500, { error: "Server configuration error" });
    return;
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("steige")
    .select<string, SteigDataFromDB>("*") // Specify expected DB row structure
    .eq("fk_haltestellen_id", stopIdParam);

  if (error) {
    console.error("Supabase error in getSteige:", error);
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (!data) {
    sendJson(res, 404, { error: "No steige found for the given stopid" });
    return;
  }

  try {
    const features: SteigGeoJsonFeature[] = data.map((steigeRecord) => {
      const wkbBuffer = Buffer.from(steigeRecord.location, "hex");
      // The geometry type parsed by wkx can be various GeoJSON geometry types
      const geometry = wkx.Geometry.parse(wkbBuffer).toGeoJSON() as GeoJsonGeometry; // Type assertion

      return {
        type: "Feature",
        geometry: geometry, // GeoJSON geometry object
        properties: {
          steig_id: steigeRecord.steig_id,
          fk_linien_id: steigeRecord.fk_linien_id,
          fk_haltestellen_id: steigeRecord.fk_haltestellen_id,
          richtung: steigeRecord.richtung,
          reihenfolge: steigeRecord.reihenfolge,
          rbl_nummer: steigeRecord.rbl_nummer,
          bereich: steigeRecord.bereich,
          steig: steigeRecord.steig,
        },
      };
    });

    const geoJsonResult: SteigFeatureCollection = {
      type: "FeatureCollection",
      features: features,
    };

    sendJson(res, 200, geoJsonResult);

  } catch (conversionError: any) {
    console.error("Error converting WKB to GeoJSON in getSteige:", conversionError);
    sendJson(res, 500, { error: "Error processing geometry data", details: conversionError.message });
  }
} 