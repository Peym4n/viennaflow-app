import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService, LineStopsResponse, MetroLine } from '../../../../core/services/api.service';
import { LocationService, Coordinates } from '../../../../core/services/location.service';
import { environment } from '../../../../../environments/environment';
import { Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, map, takeUntil, switchMap } from 'rxjs/operators';
import { NearbySteig } from '@shared-types/api-models';
import { createCustomMapOverlayClass, ICustomMapOverlay, CustomMapOverlayConstructor } from './custom-map-overlay';

// Define an extended environment interface for type safety
interface ExtendedGoogleMapsConfig {
  apiKey: string;
  mapId?: string;
}

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule
  ],
  templateUrl: './map-view.component.html',
  styleUrl: './map-view.component.css'
})
export class MapViewComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  
  private map: any = null;
  private userMarker: any = null;
  private metroLinePolylines: google.maps.Polyline[] = [];
  private stationMarkers: google.maps.Marker[] = [];
  private activeInfoWindow: google.maps.InfoWindow | null = null;
  private componentDestroyed$ = new Subject<void>();
  
  private stationMarkerMap = new Map<number, { marker: google.maps.Marker, diva?: number | string }>();
  private highlightedStationIds = new Set<number>();
  private highlightedStationOverlays: ICustomMapOverlay[] = [];
  private CustomMapOverlayCtor!: CustomMapOverlayConstructor;
  
  isLoading = true;
  hasLocationError = false;
  showMetroLines = true;
  showStations = true;
  
  private snackBar = inject(MatSnackBar);
  private mapsService = inject(GoogleMapsService);
  private apiService = inject(ApiService);
  private locationService = inject(LocationService);
  
  constructor() {}
  
  ngOnInit(): void {
    this.mapsService.loadGoogleMapsApi().pipe(
      takeUntil(this.componentDestroyed$)
    ).subscribe({
      next: () => {
        console.log('Google Maps API loaded successfully');
      },
      error: (error) => {
        console.error('Failed to load Google Maps API:', error);
        this.handleMapLoadingError('Failed to load maps. Please try again later.');
      }
    });
  }
  
  ngAfterViewInit(): void {
    console.log('View initialized, map container element:', this.mapContainer?.nativeElement);
    this.initializeMapWhenReady();
  }
  
  ngOnDestroy(): void {
    this.componentDestroyed$.next();
    this.componentDestroyed$.complete();
    
    if (this.activeInfoWindow) {
      this.activeInfoWindow.close();
      this.activeInfoWindow = null;
    }
    this.highlightedStationOverlays.forEach(overlay => overlay.destroy());
    this.highlightedStationOverlays = [];

    this.clearMetroLines();
    this.clearStationMarkers();
  }
  
  private initializeMapWhenReady(): void {
    if (this.mapsService.isGoogleMapsLoaded() && window.google && window.google.maps) {
      console.log('Google Maps API is loaded, initializing map and CustomMapOverlayCtor...');
      this.CustomMapOverlayCtor = createCustomMapOverlayClass(window.google.maps);
      this.initMap();
      this.subscribeToLocationUpdates();
    } else {
      console.log('Google Maps API not loaded yet, checking again in 100ms');
      setTimeout(() => this.initializeMapWhenReady(), 100);
    }
  }
  
  private initMap(): void {
    console.log('Initializing map...');
    const defaultCenter = { lat: 48.2082, lng: 16.3738 };
    try {
      const mapOptions: google.maps.MapOptions = {
        center: defaultCenter,
        zoom: 13,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        zoomControl: true,
      };
      const googleMapsConfig = environment.googleMaps as ExtendedGoogleMapsConfig;
      if (googleMapsConfig?.mapId) {
        (mapOptions as any).mapId = googleMapsConfig.mapId;
      }
      this.map = new window.google.maps.Map(this.mapContainer.nativeElement, mapOptions);
      
      window.google.maps.event.addListenerOnce(this.map, 'idle', () => {
        console.log('Map fully loaded and ready');
        this.loadMetroLines();
      });
      this.isLoading = false;
    } catch (error) {
      console.error('Error initializing map:', error);
      this.handleMapLoadingError('Error initializing map. Please try again.');
    }
  }
  
  private handleMapLoadingError(message: string): void {
    this.hasLocationError = true;
    this.isLoading = false;
    this.snackBar.open(message, 'Close', { duration: 5000 });
  }

  private subscribeToLocationUpdates(): void {
    this.locationService.currentLocation$.pipe(
      takeUntil(this.componentDestroyed$),
      switchMap((coordinates: Coordinates | null) => {
        if (!coordinates) {
          console.warn('MapViewComponent received null coordinates from LocationService.');
          this.hasLocationError = true;
          this.isLoading = false;
          return of(null);
        }
        console.log('MapViewComponent received location:', coordinates);
        this.hasLocationError = false;
        this.isLoading = false; 

        const userLatLng = new google.maps.LatLng(coordinates.latitude, coordinates.longitude);
        if (!this.userMarker) {
          this.userMarker = new google.maps.Marker({
            position: userLatLng,
            map: this.map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: '#4285F4',
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 2,
            },
            title: 'Your Location'
          });
          this.map.setCenter(userLatLng);
          this.map.setZoom(15);
        } else {
          this.userMarker.setPosition(userLatLng);
        }
        return this.fetchAndDisplayNearbySteige(coordinates);
      })
    ).subscribe({
      next: () => {
        console.log('Nearby Steige processing logic completed (or skipped if no coords).');
      },
      error: (error: any) => {
        console.error('MapViewComponent error during location update or Steige fetching:', error);
        this.hasLocationError = true;
        this.isLoading = false;
        const message = error?.message || 'Could not process location or fetch data.';
        this.snackBar.open(`Error: ${message}`, 'Close', { duration: 5000 });
      }
    });
  }
  
  private fetchAndDisplayNearbySteige(coordinates: Coordinates): Observable<void> {
    console.log('[MapView] Fetching nearby Steige for highlighting and overlay display:', coordinates);

    return this.apiService.getNearbySteige(coordinates.latitude, coordinates.longitude, 800).pipe(
      takeUntil(this.componentDestroyed$),
      map((steige: NearbySteig[]) => {
        console.log('[MapView] Received nearby Steige for overlay processing. Count:', steige.length);
        if (!this.map) {
            console.warn('[MapView] Map not available for displaying Steige-based highlights/overlays.');
            return; 
        }

        // Clear existing highlights and overlays now that we have new data
        this.highlightedStationIds.forEach(stationId => {
          const stationData = this.stationMarkerMap.get(stationId);
          const marker = stationData ? stationData.marker : undefined;
          if (marker) {
            const currentIcon = marker.getIcon() as google.maps.Symbol;
            if (currentIcon && typeof currentIcon === 'object') {
              marker.setIcon({...currentIcon, fillColor: '#FFFFFF'});
            }
          }
        });
        this.highlightedStationIds.clear();
    
        console.log('[MapView] Clearing old highlightedStationOverlays. Count:', this.highlightedStationOverlays.length);
        this.highlightedStationOverlays.forEach(overlay => overlay.destroy());
        this.highlightedStationOverlays = [];
        // End of clearing block

        const uniqueHaltestellenIds = new Set<number>();
        steige.forEach(s => {
          if (s.fk_haltestellen_id && typeof s.fk_haltestellen_id === 'number') { 
            uniqueHaltestellenIds.add(s.fk_haltestellen_id);
          } else if (s.fk_haltestellen_id) {
            console.warn(`[MapView] A Steig entry has non-number fk_haltestellen_id: ${s.fk_haltestellen_id}`);
          }
        });

        console.log('[MapView] Unique Haltestellen IDs to highlight and overlay:', Array.from(uniqueHaltestellenIds));

        uniqueHaltestellenIds.forEach(stationIdToHighlight => {
          const stationData = this.stationMarkerMap.get(stationIdToHighlight);
          const stationMarker = stationData ? stationData.marker : undefined;
          const divaValue = stationData ? stationData.diva : undefined;

          if (stationMarker) {
            const currentIcon = stationMarker.getIcon() as google.maps.Symbol;
            if (currentIcon && typeof currentIcon === 'object') {
                stationMarker.setIcon({...currentIcon, fillColor: 'red'});
                this.highlightedStationIds.add(stationIdToHighlight);

                if (this.CustomMapOverlayCtor && stationMarker.getPosition()) {
                  const overlayContent = `<div style="font-size: 10px; padding: 2px;">ID: ${stationIdToHighlight}<br>Diva: ${divaValue !== undefined ? divaValue : 'N/A'}</div>`;
                  const position = stationMarker.getPosition()!;
                  try {
                    const overlay = new this.CustomMapOverlayCtor(position, overlayContent);
                    overlay.setMap(this.map);
                    this.highlightedStationOverlays.push(overlay);
                  } catch (e) {
                    console.error('[MapView] Error creating CustomMapOverlay:', e);
                  }
                } else {
                  if (!this.CustomMapOverlayCtor) console.warn('[MapView] CustomMapOverlayCtor not initialized, cannot create overlay.');
                  if (!stationMarker.getPosition()) console.warn('[MapView] Station marker has no position for overlay, station ID:', stationIdToHighlight);
                }
            } else {
                console.warn(`[MapView] Could not get icon object for station ID: ${stationIdToHighlight} to highlight.`);
            }
          } else {
            console.warn(`[MapView] No station marker found for ID: ${stationIdToHighlight} to highlight or create overlay.`);
          }
        });
      }),
      catchError((error: any) => {
        console.error('[MapView] Error fetching or processing Steige for highlighting/overlays:', error);
        this.snackBar.open('Could not load nearby stop highlights/overlays.', 'Close', { duration: 3000 });
        return of(undefined); // Return an observable to keep the stream alive
      })
    );
  }

  recenterMap(): void {
    if (!this.map || !this.userMarker) return;
    
    const userPosition = this.userMarker.getPosition();
    if (userPosition) {
      this.map.setCenter(userPosition);
      this.map.setZoom(15);
    }
  }
  
  toggleMetroLines(): void {
    this.showMetroLines = !this.showMetroLines;
    this.metroLinePolylines.forEach(polyline => {
      polyline.setVisible(this.showMetroLines);
    });
  }
  
  toggleStations(): void {
    this.showStations = !this.showStations;
    this.stationMarkers.forEach(marker => {
      marker.setVisible(this.showStations);
    });
    if (!this.showStations && this.activeInfoWindow) {
      this.activeInfoWindow.close();
      this.activeInfoWindow = null;
    }
  }
  
  private loadMetroLines(): void {
    this.clearMetroLines();
    this.clearStationMarkers(); 
    
    const sub = this.apiService.getMetroLineStops().pipe(
      catchError(error => {
        console.error('Error fetching metro lines:', error);
        this.snackBar.open('Failed to load metro lines', 'Close', { duration: 3000 });
        return of(null);
      })
    ).subscribe(response => {
      if (!response) return;
      this.drawMetroLines(response);
      this.addStationMarkers(response);
    });
  }
  
  private drawMetroLines(response: LineStopsResponse): void {
    Object.entries(response.lines).forEach(([lineId, line]) => {
      if (line.lineStrings && line.lineStrings.length > 0) {
        line.lineStrings.forEach(lineString => {
          if (lineString.coordinates && lineString.coordinates.length > 1) {
            const path = lineString.coordinates.map((coords: [number, number]) => {
              const [lng, lat] = coords;
              return { lat, lng };
            });
            const polyline = new google.maps.Polyline({
              path: path,
              geodesic: true,
              strokeColor: line.farbe || '#FF0000',
              strokeOpacity: 1.0,
              strokeWeight: 4,
              map: this.map,
              visible: this.showMetroLines
            });
            this.metroLinePolylines.push(polyline);
          }
        });
      } else {
        console.warn(`Line ${lineId} (${line.bezeichnung}) does not have valid lineStrings data`);
      }
    });
  }
  
  private clearMetroLines(): void {
    this.metroLinePolylines.forEach(polyline => polyline.setMap(null));
    this.metroLinePolylines = [];
  }
  
  private clearStationMarkers(): void {
    if (this.activeInfoWindow) {
      this.activeInfoWindow.close();
      this.activeInfoWindow = null;
    }
    this.stationMarkers.forEach(marker => marker.setMap(null));
    this.stationMarkers = [];
    this.stationMarkerMap.clear();
    this.highlightedStationIds.clear();
  }
  
  private addStationMarkers(response: LineStopsResponse): void {
    const processedStationIds = new Set<number>();
    Object.entries(response.lines).forEach(([lineId, line]) => {
      const lineColor = line.farbe || '#000000';
      const features = line.stops.features;
      if (!features || features.length === 0) return;
      
      features.forEach(feature => {
        const stationId = feature.properties.haltestellen_id;
        if (processedStationIds.has(stationId)) return;
        processedStationIds.add(stationId);
        
        const [lng, lat] = feature.geometry.coordinates;
        const stationName = feature.properties.name;
        const diva = feature.properties.diva;
        
        const stationLines = feature.properties.linien_ids
          .filter((id, index, self) => self.indexOf(id) === index)
          .map(id => {
            const lineObj = response.lines[id];
            return lineObj ? { id, name: lineObj.bezeichnung, color: lineObj.farbe } : null;
          })
          .filter(lineInfo => lineInfo !== null) as { id: string; name: string; color: string | undefined }[];
        
        const strokeColor = stationLines.length >= 2 ? '#000000' : lineColor;
        
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: this.map,
          title: stationName,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#FFFFFF',
            fillOpacity: 1,
            strokeColor,
            strokeWeight: 3
          },
          visible: this.showStations
        });
        
        const infoContent = `
          <div class="gm-station-info">
            <h3>${stationName}</h3>
            <div class="gm-station-lines">
              ${stationLines.map(lineInfo => `
                <div class="gm-line-badge" style="background-color: ${lineInfo.color || '#000000'}">
                  ${lineInfo.name || ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({
          content: infoContent,
          maxWidth: 200
        });
        
        marker.addListener('click', () => {
          if (this.activeInfoWindow) {
            this.activeInfoWindow.close();
          }
          infoWindow.open(this.map, marker);
          this.activeInfoWindow = infoWindow;
        });
        
        this.stationMarkers.push(marker);
        this.stationMarkerMap.set(stationId, { marker, diva });
      });
    });
  }
}

