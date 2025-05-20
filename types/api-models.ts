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
