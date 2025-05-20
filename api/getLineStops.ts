import { readFileSync } from 'fs';
import { join } from 'path';
import { IncomingMessage, ServerResponse } from 'http';

// --- Common Vercel Request/Response Types ---
interface QueryParams {
  linien_id?: string | string[];
}

interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// --- GeoJSON Basic Types (simplified) ---
interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

interface GeoJsonLineString {
  type: "LineString";
  coordinates: Array<[number, number]>; // Array of [longitude, latitude]
}

interface GeoJsonFeature<G, P> { // G for Geometry, P for Properties
  type: "Feature";
  geometry: G;
  properties: P;
}

interface GeoJsonFeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Array<GeoJsonFeature<G, P>>;
}

// --- Specific types for lineStops.json ---
interface StopProperties {
  haltestellen_id: number;
  diva: number;
  name: string;
  linien_ids: number[]; // Array of line IDs this stop belongs to
  [key: string]: any; // Allow other properties
}

type StopFeature = GeoJsonFeature<GeoJsonPoint, StopProperties>;
type StopFeatureCollection = GeoJsonFeatureCollection<GeoJsonPoint, StopProperties>;

interface LineDetails {
  bezeichnung: string;
  farbe: string;
  reihenfolge: number;
  echtzeit: boolean;
  lineStrings: GeoJsonLineString[];
  stops: StopFeatureCollection;
  [key: string]: any; // Allow other properties
}

interface LinesObject {
  [lineId: string]: LineDetails;
}

interface MetaInfo {
  last_updated: string;
  version: string;
  [key: string]: any; // Allow other properties
}

interface LineStopsFileData {
  metainfo: MetaInfo;
  lines: LinesObject;
}

// --- Handler Function ---
export default function handler(
  req: VercelRequest,
  res: ServerResponse
): void {
  try {
    const { linien_id } = req.query;
    const filePath = join(process.cwd(), 'api', 'lineStops.json');
    
    const fileContent = readFileSync(filePath, 'utf8');
    const jsonData: LineStopsFileData = JSON.parse(fileContent);

    let linienIdQuery: string | undefined = undefined;
    if (Array.isArray(linien_id)) {
      linienIdQuery = linien_id[0];
    } else if (typeof linien_id === 'string') {
      linienIdQuery = linien_id;
    }
    
    if (!linienIdQuery) {
      sendJson(res, 200, jsonData);
      return;
    }
    
    const requestedLinienIds = linienIdQuery.split(',');
    const filteredLines: LinesObject = {};
    
    requestedLinienIds.forEach(id => {
      if (jsonData.lines && jsonData.lines[id]) {
        filteredLines[id] = jsonData.lines[id];
      }
    });
    
    const responseData: Partial<LineStopsFileData> = { // Use Partial if lines can be empty
      metainfo: jsonData.metainfo,
      lines: filteredLines
    };
    
    sendJson(res, 200, responseData);

  } catch (e: any) {
    console.error('Error fetching line stops:', e);
    const errorMessage = 'An error occurred while fetching line stops.';
    const details = process.env['NODE_ENV'] === 'development' && e instanceof Error ? e.message : undefined;
    
    sendJson(res, 500, { 
      error: errorMessage,
      details: details
    });
  }
} 