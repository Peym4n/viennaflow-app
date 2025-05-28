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
import { Observable, of, Subject, Subscription, forkJoin, timer } from 'rxjs'; // Added forkJoin, timer
import { catchError, map, takeUntil, switchMap, tap, mapTo, exhaustMap } from 'rxjs/operators'; // Added tap, mapTo, exhaustMap
import { NearbySteig, MonitorApiResponse, MonitorLine as RealTimeMonitorLine, Monitor } from '@shared-types/api-models'; // Added MonitorApiResponse and RealTimeMonitorLine
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
  // Device detection
  isMobile = false;
  private mediaQueryList!: MediaQueryList;
  private mediaQueryListener: (() => void) | null = null;
  // Track the currently active overlay stationId on mobile
  private activeMobileOverlayStationId: number | null = null;

  // ... existing properties ...
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  
  private map: any = null;
  private userMarker: any = null;
  private metroLinePolylines: google.maps.Polyline[] = [];
  private stationMarkers: google.maps.Marker[] = [];
  private activeInfoWindow: google.maps.InfoWindow | null = null;
  private componentDestroyed$ = new Subject<void>();
  
  private stationMarkerMap = new Map<number, { marker: google.maps.Marker, diva?: number | string }>();
  private highlightedStationIds = new Set<number>(); // May still be useful for tracking which stations *should* be highlighted
  private highlightedStationOverlays: ICustomMapOverlay[] = [];
  private highlightMarkers: google.maps.Marker[] = []; // For "always shown" highlight markers
  private CustomMapOverlayCtor!: CustomMapOverlayConstructor;
  private lineStopsData: LineStopsResponse | null = null; // To store line data for filtering

  // For Polling
  private pollingSubscription?: Subscription;
  private activeDivaMapForPolling = new Map<number, string | number>(); // Stores current DIVAs for polling
  private currentPollingDivasKey: string = ''; // Stringified key of current DIVAs for polling
  private readonly pollingIntervalMs = 15000; // 15 seconds
  private stopPolling$ = new Subject<void>();
  private lastMonitorResponse: MonitorApiResponse | null = null; // Store last successful response
  private stationWalkingTimes = new Map<number, number>(); // stationId -> walking duration in minutes
  private lastWalkingTimeUpdateLocation: google.maps.LatLng | null = null;
  private walkingTimeUpdateSubscription: Subscription | null = null;
  private readonly WALKING_TIME_UPDATE_INTERVAL_MS = 60000; // 1 minute
  private readonly MIN_MOVEMENT_DISTANCE_FOR_WALKING_UPDATE_M = 50; // 50 meters


  isLoading = true;
  hasLocationError = false;
  showMetroLines = true;
  showStations = false; // Stations will be hidden initially
  
  private snackBar = inject(MatSnackBar);
  private mapsService = inject(GoogleMapsService);
  private apiService = inject(ApiService);
  private locationService = inject(LocationService);
  
  constructor() {}
  
  ngOnInit(): void {
    this.mediaQueryList = window.matchMedia('(max-width: 599px)');
    this.isMobile = this.mediaQueryList.matches;
    this.mediaQueryListener = () => {
      this.isMobile = this.mediaQueryList.matches;
      this.clearHighlightsAndOverlays();
      this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
    };
    this.mediaQueryList.addEventListener('change', this.mediaQueryListener);

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

    if (this.mediaQueryList && this.mediaQueryListener) {
      this.mediaQueryList.removeEventListener('change', this.mediaQueryListener);
    }

    if (this.activeInfoWindow) {
      this.activeInfoWindow.close();
      this.activeInfoWindow = null;
    }
    this.highlightedStationOverlays.forEach(overlay => overlay.destroy());
    this.highlightedStationOverlays = [];

    this.stopPolling$.next(); 
    this.stopPolling$.complete();
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
    if (this.walkingTimeUpdateSubscription) { 
      this.walkingTimeUpdateSubscription.unsubscribe();
    }

    this.clearMetroLines();
    this.clearStationMarkers();
  }
  
  private initializeMapWhenReady(): void {
    if (this.mapsService.isGoogleMapsLoaded() && window.google && window.google.maps && window.google.maps.geometry) {
      console.log('Google Maps API and Geometry library are loaded, initializing map and CustomMapOverlayCtor...');
      this.CustomMapOverlayCtor = createCustomMapOverlayClass(window.google.maps);
      this.initMap();
      this.subscribeToLocationUpdates();
      this.setupWalkingTimeUpdateTimer(); 
    } else {
      console.log('Google Maps API (or Geometry library) not loaded yet, checking again in 100ms');
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
        gestureHandling: 'greedy' 
      };
      const googleMapsConfig = environment.googleMaps as ExtendedGoogleMapsConfig;
      if (googleMapsConfig?.mapId) {
        (mapOptions as any).mapId = googleMapsConfig.mapId;
      }
      this.map = new window.google.maps.Map(this.mapContainer.nativeElement, mapOptions);
      
      // Add right-click listener to the map
      this.map.addListener('rightclick', (mapsMouseEvent: google.maps.MapMouseEvent) => {
        this.handleMapRightClick(mapsMouseEvent);
      });
      
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

  private handleMapRightClick(mapsMouseEvent: google.maps.MapMouseEvent): void {
    if (mapsMouseEvent.latLng) {
      const lat = parseFloat(mapsMouseEvent.latLng.lat().toFixed(7));
      const lng = parseFloat(mapsMouseEvent.latLng.lng().toFixed(7));
      const coordsString = `${lng}, ${lat}`; 

      navigator.clipboard.writeText(coordsString).then(() => {
        this.snackBar.open(`Coordinates copied: ${coordsString}`, 'Close', {
          duration: 2000, 
        });
      }).catch(err => {
        console.error('Failed to copy coordinates: ', err);
        this.snackBar.open('Failed to copy coordinates.', 'Close', {
          duration: 3000,
        });
      });
    }
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
      tap((steige: NearbySteig[]) => { 
        console.log('[MapView] Received nearby Steige for overlay processing. Count:', steige.length);
        if (!this.map) {
            console.warn('[MapView] Map not available for displaying Steige-based highlights/overlays.');
            return; 
        }

        const uniqueHaltestellenDivaMap = new Map<number, string | number>();
        steige.forEach(s => {
          if (s.fk_haltestellen_id && typeof s.fk_haltestellen_id === 'number') {
            const stationData = this.stationMarkerMap.get(s.fk_haltestellen_id);
            if (stationData?.diva && !uniqueHaltestellenDivaMap.has(s.fk_haltestellen_id)) {
              uniqueHaltestellenDivaMap.set(s.fk_haltestellen_id, stationData.diva);
            }
          }
        });

        const divaValuesToFetch = Array.from(uniqueHaltestellenDivaMap.values());
        console.log('[MapView] Unique DIVA values for real-time fetch:', divaValuesToFetch);

        this.updateMonitoredStationsAndPoll(uniqueHaltestellenDivaMap);
      }), 
      mapTo(undefined), 
      catchError((error: any) => { 
        console.error('[MapView] Error fetching Steige for polling setup:', error);
        this.snackBar.open('Could not load nearby stop data for polling.', 'Close', { duration: 3000 });
        this.clearHighlightsAndOverlays(); 
        if (this.pollingSubscription) { 
          this.pollingSubscription.unsubscribe();
        }
        this.currentPollingDivasKey = ''; 
        this.activeDivaMapForPolling.clear();
        return of(undefined); 
      })
    );
  }

  private updateMonitoredStationsAndPoll(divaMapToUpdate: Map<number, string | number>): void {
    const newDivaValues = Array.from(divaMapToUpdate.values());
    const newPollingKey = newDivaValues.sort().join(',');

    if (this.currentPollingDivasKey === newPollingKey && newDivaValues.length > 0) {
      console.log('[MapView] Monitored DIVAs unchanged, polling continues for key:', newPollingKey);
      return;
    }
    
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      console.log('[MapView] Stopped previous real-time polling due to DIVA set change or becoming empty.');
    }
    if (this.walkingTimeUpdateSubscription) { 
        this.walkingTimeUpdateSubscription.unsubscribe();
        console.log('[MapView] Stopped previous walking time timer due to DIVA set change.');
    }
    
    this.currentPollingDivasKey = newPollingKey;
    this.activeDivaMapForPolling = new Map(divaMapToUpdate);

    if (newDivaValues.length === 0) {
      console.log('[MapView] No DIVAs to monitor. Clearing overlays and stopping poll.');
      this.clearHighlightsAndOverlays();
      return;
    }

    console.log(`[MapView] Starting new data fetch for DIVAs: ${newDivaValues.join(', ')}`);
    this.clearHighlightsAndOverlays(); 

    const userLocation = this.userMarker ? this.userMarker.getPosition() : null;
    let userLocationLiteral: google.maps.LatLngLiteral | null = null;
    if (userLocation) {
      userLocationLiteral = { lat: userLocation.lat(), lng: userLocation.lng() };
    }

    const stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[] = [];
    this.activeDivaMapForPolling.forEach((_, stationId) => {
      const stationData = this.stationMarkerMap.get(stationId);
      if (stationData?.marker && stationData.marker.getPosition()) {
        const pos = stationData.marker.getPosition()!;
        stationTargets.push({ stationId, latLng: { lat: pos.lat(), lng: pos.lng() } });
      }
    });

    const walkingTimesObservable: Observable<google.maps.DistanceMatrixResponse | null> = 
      (userLocationLiteral && stationTargets.length > 0)
        ? this.mapsService.getWalkingDurationsToStations(userLocationLiteral, stationTargets.map(st => st.latLng))
        : of(null);

    if (userLocationLiteral && stationTargets.length > 0) {
      this.fetchAndStoreWalkingTimes(userLocationLiteral, stationTargets, true); 
    } else {
      this.stationWalkingTimes.clear();
      this.lastWalkingTimeUpdateLocation = null;
      if (this.highlightMarkers.length > 0 || this.highlightedStationOverlays.length > 0) {
          this.clearHighlightsAndOverlays();
          this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
      }
    }
    
    this.pollingSubscription = timer(0, this.pollingIntervalMs).pipe(
      takeUntil(this.stopPolling$),
      exhaustMap(() => {
        if (!this.lastMonitorResponse && this.highlightMarkers.length === 0 && this.activeDivaMapForPolling.size > 0) {
            this.clearHighlightsAndOverlays(); 
            this.createOverlaysForStations(this.activeDivaMapForPolling, null); 
        }
        return this.apiService.getRealTimeDepartures(newDivaValues).pipe(
          catchError((err: any) => {
            console.error('[MapView] Error fetching monitor data:', err);
            this.clearHighlightsAndOverlays();
            this.createOverlaysForStations(this.activeDivaMapForPolling, { errorOccurred: true } as any);
            this.lastMonitorResponse = null;
            return of(null);
          })
        );
      })
    ).subscribe((monitorResponse: MonitorApiResponse | null) => {
      this.clearHighlightsAndOverlays(); 
      if (monitorResponse && !(monitorResponse as any).errorOccurred) {
        this.lastMonitorResponse = monitorResponse;
      } else {
        this.lastMonitorResponse = monitorResponse; 
      }
      this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
    });

    this.setupWalkingTimeUpdateTimer();
  }

  private setupWalkingTimeUpdateTimer(): void {
    if (this.walkingTimeUpdateSubscription) {
      this.walkingTimeUpdateSubscription.unsubscribe();
    }
    this.walkingTimeUpdateSubscription = timer(this.WALKING_TIME_UPDATE_INTERVAL_MS, this.WALKING_TIME_UPDATE_INTERVAL_MS).pipe(
      takeUntil(this.componentDestroyed$), 
      takeUntil(this.stopPolling$) 
    ).subscribe(() => {
      this.checkUserMovementAndFetchWalkingTimes();
    });
    console.log('[MapView] Walking time update timer started.');
  }

  private checkUserMovementAndFetchWalkingTimes(): void {
    if (!this.userMarker || !this.mapsService.isGoogleMapsLoaded() || !window.google.maps.geometry) {
      console.log('[MapView] Walking time check: User marker or geometry library not available.');
      return;
    }
    const currentUserLocation = this.userMarker.getPosition();
    if (!currentUserLocation) {
      console.log('[MapView] Walking time check: Current user location not available.');
      return;
    }
    if (!this.lastWalkingTimeUpdateLocation) {
      console.log('[MapView] Walking time check: No previous location for comparison. Initial fetch should handle this.');
      return;
    }
    if (this.activeDivaMapForPolling.size === 0) {
      console.log('[MapView] Walking time check: No active stations to update walking times for.');
      return;
    }

    const distanceMoved = window.google.maps.geometry.spherical.computeDistanceBetween(
      currentUserLocation,
      this.lastWalkingTimeUpdateLocation
    );

    console.log(`[MapView] Walking time check: Distance moved since last update: ${distanceMoved.toFixed(2)}m`);

    if (distanceMoved > this.MIN_MOVEMENT_DISTANCE_FOR_WALKING_UPDATE_M) {
      console.log('[MapView] User moved significantly. Fetching updated walking times.');
      const stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[] = [];
      this.activeDivaMapForPolling.forEach((_, stationId) => {
        const stationData = this.stationMarkerMap.get(stationId);
        if (stationData?.marker && stationData.marker.getPosition()) {
          const pos = stationData.marker.getPosition()!;
          stationTargets.push({ stationId, latLng: { lat: pos.lat(), lng: pos.lng() } });
        }
      });
      
      if (stationTargets.length > 0) {
        this.fetchAndStoreWalkingTimes({ lat: currentUserLocation.lat(), lng: currentUserLocation.lng() }, stationTargets, false);
      }
    } else {
      console.log('[MapView] User has not moved significantly. No walking time update needed.');
    }
  }
  
  private fetchAndStoreWalkingTimes(
    userLocationLiteral: google.maps.LatLngLiteral, 
    stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[],
    isInitialFetchForSet: boolean 
  ): void {
    const payload = {
      origins: [userLocationLiteral],
      destinations: stationTargets.map(st => st.latLng)
    };

    this.apiService.getSecureWalkingMatrix(payload)
      .pipe(
        takeUntil(this.componentDestroyed$),
        catchError(err => {
          console.error('[MapView] Error fetching secure walking matrix:', err);
          if (isInitialFetchForSet) {
            this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(userLocationLiteral.lat, userLocationLiteral.lng);
            console.log('[MapView] Updated lastWalkingTimeUpdateLocation (on error) to:', userLocationLiteral);
          }
          this.stationWalkingTimes.clear(); 
          this.clearHighlightsAndOverlays();
          this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
          return of(null); 
        })
      )
      .subscribe(matrixResponse => { 
        if (!matrixResponse) { 
            return;
        }

        // Successful response from backend (which proxied Google)
        if (isInitialFetchForSet || (matrixResponse.rows && matrixResponse.rows.length > 0)) {
        this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(userLocationLiteral.lat, userLocationLiteral.lng);
        console.log('[MapView] Updated lastWalkingTimeUpdateLocation to:', userLocationLiteral);
        }

        const newWalkingTimes = new Map<number, number>();
        if (matrixResponse.rows && matrixResponse.rows.length > 0) {
          matrixResponse.rows[0].elements.forEach((element: any, index: number) => { 
            const targetStation = stationTargets[index];
            if (targetStation && element.status === 'OK' && element.duration) { 
              const durationInMinutes = Math.round(element.duration.value / 60);
              newWalkingTimes.set(targetStation.stationId, durationInMinutes);
            } else {
              console.warn(`Could not get walking time for station ID ${targetStation?.stationId}: Status ${element?.status}`);
            }
          });
        }
        this.stationWalkingTimes = newWalkingTimes;
        console.log('[MapView] Walking times fetched/updated via backend:', this.stationWalkingTimes);

        this.clearHighlightsAndOverlays();
        this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
      });
  }

  private clearHighlightsAndOverlays(): void {
    console.log('[MapView] Clearing old highlightMarkers. Count:', this.highlightMarkers.length);
    this.highlightMarkers.forEach(marker => marker.setMap(null));
    this.highlightMarkers = [];

    this.highlightedStationIds.clear(); 

    console.log('[MapView] Clearing old highlightedStationOverlays. Count:', this.highlightedStationOverlays.length);
    this.highlightedStationOverlays.forEach(overlay => overlay.destroy());
    this.highlightedStationOverlays = [];
  }

  private createOverlaysForStations(
    stationDivaMap: Map<number, string | number>, 
    monitorResponse: MonitorApiResponse | null
  ): void {
    let mobileClosestStationId: number | null = null;
    if (this.isMobile && this.userMarker && this.userMarker.getPosition()) {
      console.log('[MapView] activeMobileOverlayStationId:', this.activeMobileOverlayStationId);
      if (this.activeMobileOverlayStationId !== null) {
        // If user has clicked a marker, treat it as the closest
        mobileClosestStationId = this.activeMobileOverlayStationId;
      } else {
        // Otherwise, calculate the closest station
        let minDist = Number.POSITIVE_INFINITY;
        const userPos = this.userMarker.getPosition();
        stationDivaMap.forEach((_diva, stationId) => {
          const markerData = this.stationMarkerMap.get(stationId);
          if (markerData && markerData.marker && markerData.marker.getPosition()) {
            const pos = markerData.marker.getPosition();
            const dist = window.google.maps.geometry.spherical.computeDistanceBetween(userPos, pos);
            if (dist < minDist) {
              minDist = dist;
              mobileClosestStationId = stationId;
            }
          }
        });
        if (mobileClosestStationId !== null) {
          this.activeMobileOverlayStationId = mobileClosestStationId;
        }
      }
      console.log('[MapView] Mobile closest station ID:', mobileClosestStationId);
    }

    const validLineBezeichnungen = new Set<string>();
    if (this.lineStopsData) {
      Object.values(this.lineStopsData.lines).forEach(line => {
        validLineBezeichnungen.add(line.bezeichnung);
      });
    }
    console.log('[MapView] Valid line Bezeichnungen for filtering departures:', Array.from(validLineBezeichnungen));

    stationDivaMap.forEach((divaValue, stationIdToHighlight) => {

      const stationData = this.stationMarkerMap.get(stationIdToHighlight);
      const originalStationMarker = stationData?.marker; 

      if (originalStationMarker && originalStationMarker.getPosition()) {
        this.highlightedStationIds.add(stationIdToHighlight); // Track that this station ID has a highlight/overlay

        const originalIcon = originalStationMarker.getIcon() as google.maps.Symbol | null;
        const originalStrokeColor = (originalIcon && typeof originalIcon === 'object' && originalIcon.strokeColor) ? originalIcon.strokeColor : '#000000'; // Default to black if not found

        // Create a new marker for the highlight
        const highlightMarker = new google.maps.Marker({
          position: originalStationMarker.getPosition(),
          map: this.map,
          title: originalStationMarker.getTitle(), // Same title
          icon: { // Style for the highlight marker
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7, // Same scale or slightly different if desired
            fillColor: '#6495ED', // Cornflower Blue for highlight
            fillOpacity: 1,
            strokeColor: originalStrokeColor, // Use original marker's stroke color
            strokeWeight: originalIcon?.strokeWeight || 2 // Use original stroke weight or default
          },
          zIndex: google.maps.Marker.MAX_ZINDEX + 1 // Ensure it's on top
        });
        this.highlightMarkers.push(highlightMarker);

        // Make highlight marker clickable to show overlay for that station (on mobile)
        highlightMarker.addListener('click', () => {
          if (this.isMobile) {
            // If already open, do nothing
            if (this.activeMobileOverlayStationId === stationIdToHighlight) return;
            this.activeMobileOverlayStationId = stationIdToHighlight;
            console.log('[MapView] Mobile overlay station changed to:', stationIdToHighlight);
            this.clearHighlightsAndOverlays();
            this.createOverlaysForStations(stationDivaMap, monitorResponse);
          }
        });

        // --- Overlay (conditionally) ---
        let shouldShowOverlay = true;
        if (this.isMobile) {
          const activeId = this.activeMobileOverlayStationId ?? mobileClosestStationId;
          shouldShowOverlay = (stationIdToHighlight === activeId);
        }
        if (!shouldShowOverlay) {
          return; // Only skip overlay, not marker
        }

        let realTimeHtml = '';
        // Check for our custom errorOccurred flag first
        if (monitorResponse && (monitorResponse as any).errorOccurred) {
          realTimeHtml = `<div class="status-message">Error loading real-time data.</div>`;
        } else if (monitorResponse === null || monitorResponse === undefined) {
          realTimeHtml = `<div class="loading-message">Loading real-time data...</div>`;
        } else if (monitorResponse.data?.monitors && Array.isArray(monitorResponse.data.monitors)) {
            const stationMonitor = monitorResponse.data.monitors.find(
              (m: Monitor) => m.locationStop.properties.name === String(divaValue) || 
                   (m.locationStop.properties.attributes && m.locationStop.properties.attributes.rbl === Number(divaValue))
            );

            if (stationMonitor) {
              const departuresHtmlParts: string[] = [];
              if (stationMonitor.lines && Array.isArray(stationMonitor.lines)) {
                stationMonitor.lines.forEach((line: RealTimeMonitorLine) => {
                  if (validLineBezeichnungen.has(line.name) && line.departures?.departure?.length > 0) {
                    const firstDeparture = line.departures.departure[0];
                    if (firstDeparture?.departureTime) {
                      let lineColor = '#808080'; // Default gray color if not found
                      if (this.lineStopsData && this.lineStopsData.lines) {
                        const metroLineDetails = Object.values(this.lineStopsData.lines).find(
                          (metroLine: MetroLine) => metroLine.bezeichnung === line.name
                        );
                        if (metroLineDetails && metroLineDetails.farbe) {
                          lineColor = metroLineDetails.farbe;
                        }
                      }
                      // Apply the class and only keep dynamic background-color inline
                      const lineNameHtml = `<div class="gm-line-badge" style="background-color: ${lineColor};">${line.name}</div>`;
                      
                      // Helper function to generate HTML for a single countdown item
                      const getCountdownItemHtml = (countdown: number, isFirst: boolean): string => {
                        const itemClass = isFirst ? "line-countdown-item line-countdown-first" : "line-countdown-item";
                        if (countdown <= 0) {
                          // HTML for two blinking dots
                          return `<span class="${itemClass} line-countdown-now blinking-dots-container"><span class="blinking-dot dot1"></span><span class="blinking-dot dot2"></span></span>`;
                        }
                        return `<span class="${itemClass} line-countdown">${countdown}'</span>`;
                      };

                      let countdownsInnerHtml = getCountdownItemHtml(firstDeparture.departureTime.countdown, true);
                      
                      // Check for a second departure
                      if (line.departures.departure.length > 1) {
                        const secondDeparture = line.departures.departure[1];
                        if (secondDeparture?.departureTime) {
                          countdownsInnerHtml += ` <span class="countdown-separator">|</span> ${getCountdownItemHtml(secondDeparture.departureTime.countdown, false)}`;
                        }
                      }
                      
                      // Wrap all countdowns in a single wrapper for right alignment
                      const countdownsWrapperHtml = `<span class="countdown-wrapper">${countdownsInnerHtml}</span>`;

                      departuresHtmlParts.push(
                        `<div class="departure-line">` +
                          lineNameHtml + // Use the styled pill
                          ` <span class="material-icons line-direction-arrow-icon">chevron_right</span> ` +
                          `<span class="line-direction">${line.towards}</span>: ` +
                          countdownsWrapperHtml + // Use the wrapped countdowns HTML
                        `</div>`
                      );
                    }
                  }
                });
              }
              if (departuresHtmlParts.length > 0) {
                realTimeHtml = departuresHtmlParts.join('');
              } else {
                realTimeHtml = `<div class="status-message">No current departures matching filters.</div>`;
              }
            } else {
               realTimeHtml = `<div class="status-message">No departures found!</div>`;
            }
          } else {
            // monitorResponse is not null, but data.monitors is not as expected, or other structure issue
            realTimeHtml = `<div class="status-message">Real-time data format error or empty response.</div>`;
          }

          if (this.CustomMapOverlayCtor && highlightMarker.getPosition()) { // Use highlightMarker for overlay
            const stationName = highlightMarker.getTitle() || 'Unknown Station';
            const walkingTimeInMinutes = this.stationWalkingTimes.get(stationIdToHighlight);
            let walkingTimeDisplayHtml = '';
            if (walkingTimeInMinutes !== undefined) {
              walkingTimeDisplayHtml = `
                <span class="walking-time-info">
                  <span class="material-icons walking-time-icon">directions_walk</span>
                  <span class="walking-time-value">${walkingTimeInMinutes}'</span>
                </span>`;
            }

            const overlayContent = `
              <div class="custom-map-overlay">
                <div class="station-info-header">
                  <span class="station-name-bold">${stationName}</span>
                  ${walkingTimeDisplayHtml}
                </div>
                <div class="real-time-data">
                  ${realTimeHtml}
                </div>
              </div>`;
            const position = highlightMarker.getPosition()!;
            try {
              const overlay = new this.CustomMapOverlayCtor(position, overlayContent);
              overlay.setMap(this.map); // Attach overlay to the map
              this.highlightedStationOverlays.push(overlay);
            } catch (e) {
              console.error('[MapView] Error creating CustomMapOverlay:', e);
            }
          }
        // Original stationMarker (from stationMarkerMap) is not modified in appearance
      } else {
        console.warn(`[MapView] No original station marker found for ID: ${stationIdToHighlight} to create highlight marker and overlay.`);
      }
    });
  } // This closing brace was missing or misplaced, ensuring createOverlaysForStations is properly closed.

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
    
    this.apiService.getMetroLineStops().pipe(
      takeUntil(this.componentDestroyed$),
      tap(response => { // Store the response for later use
        if (response) {
          this.lineStopsData = response; 
          console.log('[MapView] Metro line and stops data loaded and stored.');
        }
      }),
      catchError(error => {
        console.error('Error fetching metro lines:', error);
        this.snackBar.open('Failed to load metro lines', 'Close', { duration: 3000 });
        this.lineStopsData = null; // Clear on error
        return of(null);
      })
    ).subscribe(response => {
      if (!response) return;
      this.drawMetroLines(response); // Pass response directly
      this.addStationMarkers(response); // Pass response directly
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
            // Add right-click listener to each polyline
            polyline.addListener('rightclick', (polylineMouseEvent: google.maps.PolyMouseEvent) => {
              this.handleMapRightClick(polylineMouseEvent); // Re-use the same handler
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
