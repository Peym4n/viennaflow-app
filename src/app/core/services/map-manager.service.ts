import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GoogleMapsService } from './google-maps.service';
import { Coordinates } from './location.service';
import { environment } from '../../../environments/environment';

export interface MapState {
  isInitialized: boolean;
  isMobile: boolean;
  showMetroLines: boolean;
  showStations: boolean;
  userLocation: google.maps.LatLng | null;
  lastProcessedLocation: google.maps.LatLng | null;
  lastKnownLocationForSpeed: { latLng: google.maps.LatLng; timestamp: number } | null;
  isLoading: boolean;
}

export interface MapConfig {
  initialZoom: number;
  initialCenter: google.maps.LatLngLiteral;
  walkingSpeedThreshold: number;
  significantMovementThreshold: number;
  fullResetDistanceThreshold: number;
}

@Injectable({
  providedIn: 'root'
})
export class MapManagerService implements OnDestroy {
  private readonly defaultConfig: MapConfig = {
    initialZoom: 12,
    initialCenter: { lat: 48.2082, lng: 16.3738 }, // Vienna center
    walkingSpeedThreshold: 2.5, // m/s
    significantMovementThreshold: 50, // meters
    fullResetDistanceThreshold: 1000 // meters
  };

  private map: google.maps.Map | null = null;
  private userMarker: google.maps.Marker | null = null;
  private metroLinePolylines: google.maps.Polyline[] = [];
  private stationMarkers = new Map<number, google.maps.Marker>();

  private standardMarkerIcon: google.maps.Symbol | null = null;
  private highlightedMarkerIcon: google.maps.Symbol | null = null;
  private state = new BehaviorSubject<MapState>({
    isInitialized: false,
    isMobile: false,
    showMetroLines: true,
    showStations: true,
    userLocation: null,
    lastProcessedLocation: null,
    lastKnownLocationForSpeed: null,
    isLoading: true
  });

  private readonly destroy$ = new Subject<void>();

  constructor(private mapsService: GoogleMapsService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get state$(): Observable<MapState> {
    return this.state.asObservable();
  }

  get currentState(): MapState {
    return this.state.value;
  }

  get mapInstance(): google.maps.Map | null {
    return this.map;
  }

  private initializeMarkerStyles(): void {
    this.standardMarkerIcon = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 5,
      fillColor: '#FFFFFF',
      fillOpacity: 1,
      strokeColor: '#000000',
      strokeWeight: 1,
    };

    this.highlightedMarkerIcon = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8, // Larger
      fillColor: '#FFD700', // Gold
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2,
    };
  }

  initializeMap(mapContainer: HTMLElement, config: Partial<MapConfig> = {}): Observable<void> {
    const mergedConfig = { ...this.defaultConfig, ...config };

    return new Observable<void>(observer => {
      this.mapsService.loadGoogleMapsApi().pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          this.initializeMarkerStyles();

          this.map = new google.maps.Map(mapContainer, {
            zoom: mergedConfig.initialZoom,
            center: mergedConfig.initialCenter,
            mapId: environment.googleMaps.mapId,
            disableDefaultUI: true,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });

          this.state.next({ ...this.state.value, isInitialized: true });
          observer.next();
          observer.complete();
        },
        error: (err) => {
          console.error('MapManagerService: Error loading Google Maps API', err);
          observer.error(err);
        },
      });
    });
  }

  updateUserLocation(coordinates: Coordinates): void {
    if (!this.map) return;

    const newLocation = new google.maps.LatLng(coordinates.latitude, coordinates.longitude);
    const isFirstUpdate = !this.currentState.userLocation;

    // Create or update user marker
    if (!this.userMarker) {
      this.userMarker = new google.maps.Marker({
        position: newLocation,
        map: this.map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        },
      });
    } else {
      this.userMarker.setPosition(newLocation);
    }

    // Pan to location on the first update
    if (isFirstUpdate) {
      this.map.panTo(newLocation);
      this.map.setZoom(15); // Set a reasonable zoom level
    }

    // Update state with the new location
    this.state.next({
      ...this.state.value,
      userLocation: newLocation,
    });
  }

  calculateMovementMetrics(newLocation: google.maps.LatLng): {
    distance: number;
    speed: number;
    shouldUpdateNearbyStations: boolean;
    shouldFullReset: boolean;
  } {
    const currentState = this.state.value;
    const lastLocation = currentState.lastKnownLocationForSpeed;
    
    if (!lastLocation) {
      return {
        distance: 0,
        speed: 0,
        shouldUpdateNearbyStations: true,
        shouldFullReset: false
      };
    }

    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      lastLocation.latLng,
      newLocation
    );

    const timeDiff = Date.now() - lastLocation.timestamp;
    const speed = timeDiff > 0 ? (distance / timeDiff) * 1000 : 0; // Convert to m/s

    return {
      distance,
      speed,
      shouldUpdateNearbyStations: distance > this.defaultConfig.significantMovementThreshold,
      shouldFullReset: distance > this.defaultConfig.fullResetDistanceThreshold
    };
  }

        drawMetroLines(lines: any[]): void {
    this.clearMetroLines();
    console.log(`MapManagerService: Drawing ${lines.length} metro lines.`);
    lines.forEach(line => {
      if (line && Array.isArray(line.lineStrings)) {
        line.lineStrings.forEach((lineString: any) => {
          if (lineString && Array.isArray(lineString.coordinates)) {
            const linePath = lineString.coordinates.map((coord: any) => ({ lat: coord[1], lng: coord[0] }));
            const polyline = new google.maps.Polyline({
              path: linePath,
              geodesic: true,
              strokeColor: line.farbe || '#FF0000',
              strokeOpacity: 1.0,
              strokeWeight: 4,
              map: this.currentState.showMetroLines ? this.map : null
            });
            this.metroLinePolylines.push(polyline);
          }
        });
      } else {
        console.error('MapManagerService: Invalid line data received, cannot draw polyline.', line);
      }
    });
    console.log(`MapManagerService: Total polylines created: ${this.metroLinePolylines.length}`);
  }

  clearMetroLines(): void {
    this.metroLinePolylines.forEach(polyline => polyline.setMap(null));
    this.metroLinePolylines = [];
  }

  drawStationMarkers(stations: any[], highlightedStationIds: Set<number> = new Set()): void {
    if (!this.standardMarkerIcon || !this.highlightedMarkerIcon) {
      console.error('MapManagerService: Marker styles not initialized.');
      return;
    }
    this.clearStationMarkers();
    console.log(`MapManagerService: Drawing ${stations.length} station markers.`);
    stations.forEach(station => {
      const isHighlighted = highlightedStationIds.has(station.id);
      const marker = new google.maps.Marker({
        position: station.position,
        map: this.currentState.showStations ? this.map : null,
        title: station.name,
        icon: isHighlighted ? this.highlightedMarkerIcon : this.standardMarkerIcon,
        zIndex: isHighlighted ? 1 : 0,
      });
      this.stationMarkers.set(station.id, marker);
    });
  }

  clearStationMarkers(): void {
    this.stationMarkers.forEach(marker => marker.setMap(null));
    this.stationMarkers.clear();
  }

  recenterMap(location: google.maps.LatLng): void {
    if (this.map) {
      this.map.panTo(location);
      this.map.setZoom(15);
    }
  }

  toggleMetroLines(show: boolean): void {
    this.state.next({
      ...this.state.value,
      showMetroLines: show
    });
    this.metroLinePolylines.forEach(polyline => polyline.setMap(show ? this.map : null));
  }

  toggleStations(show: boolean): void {
    this.state.next({
      ...this.state.value,
      showStations: show
    });
    this.stationMarkers.forEach(marker => marker.setMap(show ? this.map : null));
  }

  setMobileMode(isMobile: boolean): void {
    this.state.next({
      ...this.state.value,
      isMobile
    });
  }

  setLoading(isLoading: boolean): void {
    this.state.next({
      ...this.state.value,
      isLoading
    });
  }
} 