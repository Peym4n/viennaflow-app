import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import wkx from "wkx";
import { IncomingMessage, ServerResponse } from 'http';

// --- Common Vercel Request/Response Types ---
interface QueryParams {
  haltestellen_ids?: string | string[]; // Comma-separated string or array
  linien_id?: string | string[];
}

interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// --- GeoJSON Basic Types (reuse if defined elsewhere) ---
interface GeoJsonGeometry {
  type: string;
  coordinates: any;
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

// --- Specific types for 'haltestellen' table and related data ---
interface HaltestelleDataFromDB {
  location: string; // WKB string
  haltestellen_id: number;
  diva: number | null;
  name: string | null;
  [key: string]: any;
}

interface HaltestelleProperties {
  haltestellen_id: number;
  diva: number | null;
  name: string | null;
  linien_ids: number[]; // Will be populated from a separate query
}

type HaltestelleGeoJsonFeature = GeoJsonFeature<GeoJsonGeometry, HaltestelleProperties>;
type HaltestelleFeatureCollection = GeoJsonFeatureCollection<GeoJsonGeometry, HaltestelleProperties>;

// Types for data from 'steige' and 'linien' tables for intermediate queries
interface SteigForLinieDB {
  fk_haltestellen_id: number;
}

interface SteigForMetroHaltestellenDB {
  fk_haltestellen_id: number;
  // Assuming linien relationship exists and verkehrsmittel is a field in linien table
  linien?: { verkehrsmittel: string } | null; 
}

interface SteigWithLinieInfoDB {
  fk_haltestellen_id: number;
  fk_linien_id: number;
  linien?: { verkehrsmittel: string } | null;
}


export default async function handler(
  req: VercelRequest,
  res: ServerResponse
): Promise<void> {
  const { haltestellen_ids, linien_id } = req.query;

  const supabaseUrl = dotenvx.get("SUPABASE_URL");
  const supabaseAnonKey = dotenvx.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or Anon Key is missing for getStops");
    sendJson(res, 500, { error: "Server configuration error" });
    return;
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  
  try {
    let stationIds: number[] = [];
    const linienIdParam = Array.isArray(linien_id) ? linien_id[0] : linien_id;
    let haltestellenIdsParam = Array.isArray(haltestellen_ids) ? haltestellen_ids[0] : haltestellen_ids;
    
    // Fall 1: Haltestellen einer bestimmten Linie abfragen
    if (linienIdParam) {
      const { data: steigeData, error: steigeError } = await supabase
        .from("steige")
        .select<string, SteigForLinieDB>("fk_haltestellen_id")
        .eq("fk_linien_id", parseInt(linienIdParam,10)) // Assuming linien_id is numeric
        .eq("richtung", "H") // Consider if this filter is always needed
        .order("reihenfolge", { ascending: true });

      if (steigeError) throw steigeError;
      if (steigeData?.length) {
        stationIds = steigeData.map(steig => steig.fk_haltestellen_id);
      }
    }
    // Fall 2: Spezifische Haltestellen anhand ihrer IDs abfragen
    else if (haltestellenIdsParam) {
      stationIds = (haltestellenIdsParam as string)
        .split(',')
        .map(id => parseInt(id.trim(), 10)) // Assuming IDs are numeric
        .filter(id => !isNaN(id)); // Filter out NaN values from parsing
    }
    // Fall 3: Standardfall - Alle Metro-Haltestellen abfragen
    else {
      const { data: steigeData, error: joinError } = await supabase
        .from("steige")
        .select<string, SteigForMetroHaltestellenDB>("fk_haltestellen_id, linien!inner(verkehrsmittel)")
        .eq("linien.verkehrsmittel", "ptMetro");

      if (joinError) throw joinError;
      if (steigeData?.length) {
        stationIds = [...new Set(steigeData.map(steig => steig.fk_haltestellen_id))];
      }
    }

    if (stationIds.length === 0) {
      sendJson(res, 200, { type: "FeatureCollection", features: [] });
      return;
    }

    const { data: haltestellenData, error: haltestellenError } = await supabase
      .from("haltestellen")
      .select<string, HaltestelleDataFromDB>("*")
      .in('haltestellen_id', stationIds);

    if (haltestellenError) throw haltestellenError;
    
    if (!haltestellenData?.length) {
      sendJson(res, 200, { type: "FeatureCollection", features: [] });
      return;
    }

    // Get Metro lines for all found Haltestellen
    const stopLineMap: { [key: number]: number[] } = {};
    const { data: steigeLinienData, error: steigeLinienError } = await supabase
      .from("steige")
      .select<string, SteigWithLinieInfoDB>("fk_haltestellen_id, fk_linien_id, linien!inner(verkehrsmittel)")
      .in("fk_haltestellen_id", stationIds)
      .eq("linien.verkehrsmittel", "ptMetro");

    if (steigeLinienError) throw steigeLinienError;

    steigeLinienData?.forEach(steig => {
      if (!stopLineMap[steig.fk_haltestellen_id]) {
        stopLineMap[steig.fk_haltestellen_id] = [];
      }
      stopLineMap[steig.fk_haltestellen_id].push(steig.fk_linien_id);
    });

    const dataMap: { [id: number]: HaltestelleDataFromDB } = {};
    haltestellenData.forEach(item => dataMap[item.haltestellen_id] = item);
    
    const sortedData = stationIds
      .map(id => dataMap[id])
      .filter((item): item is HaltestelleDataFromDB => Boolean(item)); // Type guard

    const features: HaltestelleGeoJsonFeature[] = sortedData.map(halt => {
      const wkbBuffer = Buffer.from(halt.location, "hex");
      const geometry = wkx.Geometry.parse(wkbBuffer).toGeoJSON() as GeoJsonGeometry;

      return {
        type: "Feature",
        geometry: geometry,
        properties: {
          haltestellen_id: halt.haltestellen_id,
          diva: halt.diva,
          name: halt.name,
          linien_ids: stopLineMap[halt.haltestellen_id] || [],
        },
      };
    });

    sendJson(res, 200, { type: "FeatureCollection", features });

  } catch (error: any) {
    console.error("Error in getStops API:", error.message, error.details || '');
    sendJson(res, 500, { error: error.message });
  }
} 