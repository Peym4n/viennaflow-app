// types/api-models.ts

// Define GeoJsonPoint structure
export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

// This is what the API endpoint might initially fetch or expect in some forms.
export interface RawNearbySteig {
  steig_id: number;
  // fk_linien_id can be a string or number from the raw RPC response
  fk_linien_id: number | string; 
  linien_bezeichnung: string;
  fk_haltestellen_id: number;
  haltestellen_name: string;
  richtung: string;
  rbl_nummer: number | null;
  // Location is initially a string (e.g., from DB or raw API response)
  location: string; 
}

// This type represents the Steig data after the location string has been parsed into an object
// and fk_linien_id has been ensured to be a number.
export interface NearbySteig extends Omit<RawNearbySteig, 'location' | 'fk_linien_id'> {
  location: GeoJsonPoint;
  fk_linien_id: number; // Ensure fk_linien_id is a number in the processed type
}

// Interfaces for Wiener Linien Monitor API
export interface MonitorVehicle {
  name: string;
  towards: string;
  direction: string;
  platform?: string;
  richtungsId: string;
  barrierFree: boolean;
  foldingRamp?: boolean;
  realtimeSupported: boolean;
  trafficjam: boolean;
  type: string;
  attributes: Record<string, any>; // Using Record<string, any> for generic attributes
  linienId: number;
}

export interface MonitorDepartureTime {
  timePlanned: string;
  timeReal?: string;
  countdown: number;
}

export interface MonitorDeparture {
  departureTime: MonitorDepartureTime;
  vehicle?: MonitorVehicle; // Optional as seen in U6 departures in sample
}

export interface MonitorLine {
  name: string;
  towards: string;
  direction: string;
  platform?: string;
  richtungsId?: string;
  barrierFree: boolean;
  realtimeSupported: boolean;
  trafficjam: boolean;
  departures: {
    departure: MonitorDeparture[];
  };
  type: string;
  lineId: number;
}

export interface MonitorLocationStopProperties {
  name: string; // This is often the DIVA or RBL number
  title: string; // This is the human-readable station name
  municipality: string;
  municipalityId: number;
  type: string;
  coordName: string;
  attributes: {
    rbl?: number;
  };
  gate?: string;
}

export interface MonitorLocationStopGeometry {
  type: string;
  coordinates: [number, number]; // [longitude, latitude]
}

export interface MonitorLocationStop {
  type: string;
  geometry: MonitorLocationStopGeometry;
  properties: MonitorLocationStopProperties;
}

export interface Monitor {
  locationStop: MonitorLocationStop;
  lines: MonitorLine[];
  attributes: Record<string, any>;
}

export interface MonitorData {
  monitors: Monitor[];
  // trafficInfos?: any[]; // Add if needed based on full API spec
}

export interface MonitorMessage {
  value: string;
  messageCode: number;
  serverTime: string;
}

export interface MonitorApiResponse {
  data: MonitorData;
  message: MonitorMessage;
}
