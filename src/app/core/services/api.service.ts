import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NearbySteig } from '@shared-types/api-models';

// Type definitions for the API responses
export interface MetroLine {
  bezeichnung: string;
  farbe: string;
  reihenfolge: number;
  echtzeit: boolean;
  stops: GeoJsonFeatureCollection;
  lineStrings: GeoJsonLineString[];
}

export interface GeoJsonLineString {
  type: string;
  coordinates: [number, number][];
}

export interface GeoJsonFeatureCollection {
  type: string;
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  properties: {
    haltestellen_id: number;
    diva: number;
    name: string;
    linien_ids: string[];
  };
}

export interface LineStopsResponse {
  metainfo: {
    last_updated: string;
    version: string;
  };
  lines: { [key: string]: MetroLine };
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  constructor(private http: HttpClient) {}

  /**
   * Fetches metro line stops data from the API
   * @param linienIds Optional array of line IDs to filter by
   * @returns Observable with the line stops data
   */
  getMetroLineStops(linienIds?: string[]): Observable<LineStopsResponse> {
    let url = '/api/getLineStops';
    
    // Add line_id filter if provided
    if (linienIds && linienIds.length > 0) {
      url += `?linien_id=${linienIds.join(',')}`;
    }
    
    return this.http.get<LineStopsResponse>(url);
  }
  
  /**
   * Fetches stops data from the API
   * @param linienId Optional line ID to filter by
   * @returns Observable with the stops data
   */
  getStops(linienId?: string): Observable<any> {
    let url = '/api/getStops';
    
    // Add line_id filter if provided
    if (linienId) {
      url += `?linien_id=${linienId}`;
    }
    
    return this.http.get<any>(url);
  }

  /**
   * Fetches nearby Steige (platforms/stops) based on geographic coordinates.
   * @param latitude The latitude of the center point.
   * @param longitude The longitude of the center point.
   * @param radius Optional radius in meters to search within (defaults to 1000m on the backend).
   * @returns Observable with an array of NearbySteig objects.
   */
  getNearbySteige(latitude: number, longitude: number, radius?: number): Observable<NearbySteig[]> {
    let params = new HttpParams()
      .set('lat', latitude.toString())
      .set('lon', longitude.toString());

    if (radius !== undefined) {
      params = params.set('radius', radius.toString());
    }

    return this.http.get<NearbySteig[]>('/api/getNearbySteige', { params });
  }
}
