import { Injectable, NgZone, inject } from '@angular/core'; // Added NgZone, inject
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http'; // Added HttpHeaders
import { Observable, of, switchMap, map } from 'rxjs'; // Added switchMap, map
import { NearbySteig, MonitorApiResponse } from '@shared-types/api-models';
import { SessionService } from './session.service'; // Import SessionService
import * as CryptoJS from 'crypto-js'; // For HMAC signing

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
  private sessionService = inject(SessionService); // Inject SessionService

  constructor(private http: HttpClient, private ngZone: NgZone) {} 

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

  /**
   * Fetches real-time departure data from the Wiener Linien OGD API.
   * @param divaValues An array of DIVA numbers for the stations.
   * @returns Observable that emits real-time monitor data via SSE.
   */
  // Changed from SSE to a single HTTP GET request for polling by the client
  getRealTimeDepartures(divaValues: (string | number)[]): Observable<MonitorApiResponse> {
    if (!divaValues || divaValues.length === 0) {
      // Return an Observable of a valid MonitorApiResponse with empty monitors
      return of({ 
        data: { monitors: [] }, 
        message: { value: "No DIVA values provided for monitoring.", messageCode: 0, serverTime: new Date().toISOString()} 
      } as MonitorApiResponse);
    }

    let params = new HttpParams();
    divaValues.forEach(diva => {
      // HttpParams automatically handles URL encoding for parameter values
      params = params.append('diva', diva.toString());
    });

    // The backend endpoint remains the same, but now serves a single JSON response
    return this.http.get<MonitorApiResponse>('/api/getWienerLinienMonitor', { params });
  }

  /**
   * Fetches walking durations from the secure backend endpoint.
   * @param payload Object containing origins and destinations LatLngLiterals.
   * @returns Observable with the Distance Matrix API response from the backend.
   */
  getSecureWalkingMatrix(payload: {
    origins: { lat: number; lng: number }[];
    destinations: { lat: number; lng: number }[];
  }): Observable<any> { // Consider creating a stricter type for the expected response
    return this.sessionService.ensureSessionSigningKey().pipe(
      switchMap(sessionSigningKey => {
        if (!sessionSigningKey) {
          console.error('No session signing key available for secure call.');
          throw new Error('Session not initialized or key not available.');
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();
        // Ensure the payload stringification is identical to how the server expects it
        // Vercel's req.body is typically the parsed object if Content-Type is application/json
        const messageToSign = timestamp + '.' + JSON.stringify(payload); 
        const signature = CryptoJS.HmacSHA256(messageToSign, sessionSigningKey).toString(CryptoJS.enc.Hex);

        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          'X-Timestamp': timestamp,
          'X-Signature': signature,
        });

        return this.http.post('/api/routes/walking-matrix', payload, { headers });
      })
    );
  }
}
