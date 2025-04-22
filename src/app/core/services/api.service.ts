import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Type definitions for the API responses
export interface MetroLine {
  bezeichnung: string;
  farbe: string;
  reihenfolge: number;
  echtzeit: boolean;
  stops: GeoJsonFeatureCollection;
  lineString?: GeoJsonLineString;
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
}
