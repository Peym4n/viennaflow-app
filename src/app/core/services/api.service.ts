import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, from, switchMap, catchError, map, throwError } from 'rxjs';
import { NearbySteig, WalkingPayload, WalkingMatrix } from '@shared-types/api-models';

import { MonitorApiResponse } from '@shared-types/api-models';
export type { MonitorApiResponse } from '@shared-types/api-models';
import { normalizeDiva, normalizeMonitorResponse } from './monitor-response';
import { SessionService } from './session.service'; // Import SessionService
import { normalizeTransitCatalog } from '../../../../shared/transit-catalog';
import type { LineStopsResponse } from '@shared-types/api-models';
export type { LineStopsResponse, MetroLine, GeoJsonFeatureCollection, GeoJsonFeature, GeoJsonLineString } from '@shared-types/api-models';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private sessionService = inject(SessionService); // Inject SessionService

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
    
    return this.http.get<unknown>(url).pipe(map(normalizeTransitCatalog));
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

  /** Fetch and validate one departure snapshot for the requested station DIVAs. */
  getRealTimeDepartures(divaIds: (string | number)[]): Observable<MonitorApiResponse> {
    const normalizedDivaIds = [...new Set(divaIds.map(normalizeDiva).filter((diva): diva is string => !!diva))];
    if (!normalizedDivaIds.length) return of({ data: { monitors: [] }, message: 'No stations requested', timestamp: Date.now() });
    return this.http.post<unknown>('/api/routes/monitor', { divaIds: normalizedDivaIds }).pipe(
      map(normalizeMonitorResponse),
      catchError(() => of({ data: null, message: 'Unable to load departures', errorOccurred: true, timestamp: Date.now() }))
    );
  }

  /**
   * Fetches walking durations from the secure backend endpoint.
   * @param payload Object containing origins and destinations LatLngLiterals.
   * @returns Observable with the Distance Matrix API response from the backend.
   */
  getSecureWalkingMatrix(payload: WalkingPayload): Observable<WalkingMatrix> {
    const request = () => this.sessionService.ensureSessionSigningKey().pipe(
      switchMap(key => {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        return from(this.sign(timestamp + '.' + JSON.stringify(payload), key)).pipe(
          switchMap(signature => this.http.post<WalkingMatrix>('/api/routes/walking-matrix', payload, {
            headers: new HttpHeaders({ 'Content-Type': 'application/json', 'X-Timestamp': timestamp, 'X-Signature': signature }),
          })),
        );
      }),
    );
    return request().pipe(catchError(error => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.sessionService.clearSession();
        return request(); // One renewal attempt; a second failure reaches the caller.
      }
      return throwError(() => error);
    }));
  }

  private async sign(message: string, signingKey: string): Promise<string> {
    const bytes = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', bytes.encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, bytes.encode(message));
    return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
}
