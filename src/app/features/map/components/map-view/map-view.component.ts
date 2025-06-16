import { Component, OnInit, AfterViewInit, OnDestroy, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService, LineStopsResponse, MetroLine } from '../../../../core/services/api.service';
import { LocationService, Coordinates } from '../../../../core/services/location.service';
import { environment } from '../../../../../environments/environment';
import { Subject, Observable, of, Subscription, timer, interval, finalize } from 'rxjs';
import { catchError, map, takeUntil, switchMap, tap, mapTo, exhaustMap, filter, take } from 'rxjs/operators';
import { NearbySteig, MonitorApiResponse, MonitorLine as RealTimeMonitorLine, Monitor, MonitorDeparture } from '@shared-types/api-models';
import { createCustomMapOverlayClass, ICustomMapOverlay } from './custom-map-overlay';

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
  private highlightedStationIds = new Set<number>(); // Tracks stations that have a highlight marker and/or overlay

  // For nearby stations (from activeDivaMapForPolling)
  private nearbyStationOverlays = new Map<number, ICustomMapOverlay>(); // Changed to Map for efficient updates
  private nearbyStationHighlightMarkers = new Map<number, google.maps.Marker>(); // Changed to Map for efficient updates

  // For the single clicked station (not in activeDivaMapForPolling)
  private clickedStationHighlightMarker: google.maps.Marker | null = null;
  private CustomMapOverlayCtor!: any;
  private lineStopsData: LineStopsResponse | null = null; // To store line data for filtering

  // Track the currently clicked station (only one at a time)
  private clickedStationId: number | null = null;
  private clickedStationDiva: string | number | null = null;
  private clickedStationOverlay: ICustomMapOverlay | null = null;

  // For Polling
  private pollingSubscription?: Subscription;
  private activeDivaMapForPolling = new Map<number, string | number>(); // Stores current DIVAs for polling
  private currentPollingDivasKey: string = ''; // Stringified key of current DIVAs for polling
  private stopPolling$ = new Subject<void>();
  private lastMonitorResponse: MonitorApiResponse | null = null; // Store last successful response
  private stationWalkingTimes = new Map<number, number>(); // stationId -> walking duration in minutes
  private nearbyStationCache = new Map<number, MonitorApiResponse>(); // Cache for nearby station data
  private lastWalkingTimeUpdateLocation: google.maps.LatLng | null = null;
  private previousUserLocation: google.maps.LatLng | null = null;
  private walkingTimeUpdateSubscription: Subscription | null = null;
  private readonly WALKING_TIME_UPDATE_INTERVAL_MS = 30000;
  private readonly MIN_MOVEMENT_DISTANCE_FOR_WALKING_UPDATE_M = 50; // 50 meters
  private isLoadingClickedStationData: boolean = false; // Track loading state for clicked station's data

  // Adaptive polling settings
  private isActivelyViewing = true; // Assume active by default
  private enableBatteryOptimization = true; // Default to battery saving mode
  private pollingIntervalMs = 15000; // Default polling interval (15 seconds)
  private readonly DEFAULT_ACTIVE_POLLING_MS = 15000; // 15 seconds when actively viewing
  private readonly DEFAULT_INACTIVE_POLLING_MS = 60000; // 60 seconds when not actively viewing
  private readonly NEARBY_STATION_POLLING_MS = 10000; // 10 seconds when near a station with imminent departure
  private readonly NEARBY_THRESHOLD_MINUTES = 5; // Consider "nearby" if within 5 minutes walking distance
  private pollingPausedInBackground = false; // Track if polling was paused due to background mode

  // For ETag handling
  private lastETag: string | null = null;

  // Track the last location that triggered a full nearby station data fetch
  private lastProcessedLocationLatLng: google.maps.LatLng | null = null;
  // Track the last location and timestamp for speed calculation
  private lastKnownLocationForSpeed: { latLng: google.maps.LatLng; timestamp: number } | null = null;
  // Define a threshold for walking speed in meters per seconds
  private readonly WALKING_SPEED_THRESHOLD_MPS = 2.5;
  // Global flag to indicate if walking times should be fetched based on the last speed calculation
  private _shouldFetchWalkingTimesGlobal: boolean = true; // Default to true (fetch walking times)

  private isFetchingWalkingTimes = false;

  /**
   * Updates the polling interval based on user context:
   * 1. When app is not visible: use longer interval (60s) or pause polling if battery optimization is enabled
   * 2. When app is visible but not near stations: use standard interval (15s)
   * 3. When near stations with imminent departures: use shorter interval (5s)
   */
  private updatePollingInterval = (): void => {
    const previousInterval = this.pollingIntervalMs;
    const wasPollingPaused = this.pollingPausedInBackground;

    // Handle background mode with battery optimization
    if (!this.isActivelyViewing && this.enableBatteryOptimization) {
      // If we're moving to background mode and battery optimization is enabled, pause polling
      if (this.pollingSubscription && !this.pollingSubscription.closed) {
        console.log('[MapView] Pausing polling due to background mode with battery optimization enabled');
        if (this.pollingSubscription) {
          this.pollingSubscription.unsubscribe();
          this.pollingSubscription = undefined;
        }
        this.pollingPausedInBackground = true;
        return; // Exit early, we're pausing polling
      }
    } else {
      // We're in foreground or battery optimization is disabled
      this.pollingPausedInBackground = false;

      // Start with base interval depending on whether app is in foreground/background
      this.pollingIntervalMs = this.isActivelyViewing ?
        this.DEFAULT_ACTIVE_POLLING_MS :
        this.DEFAULT_INACTIVE_POLLING_MS;

      // If user is within walking distance of a station, increase polling frequency
      if (this.isActivelyViewing && this.stationWalkingTimes.size > 0) {
        // Check if any station is within the NEARBY_THRESHOLD_MINUTES walking distance
        const isNearStation = Array.from(this.stationWalkingTimes.values())
          .some(walkingMinutes => walkingMinutes <= this.NEARBY_THRESHOLD_MINUTES);

        if (isNearStation) {
          console.log(`[MapView] User is near a station, using fast polling interval (${this.NEARBY_STATION_POLLING_MS / 1000}s)`);
          this.pollingIntervalMs = this.NEARBY_STATION_POLLING_MS;
        }
      }

      // If polling was paused in background mode, restart it
      if (wasPollingPaused && this.activeDivaMapForPolling.size > 0) {
        console.log('[MapView] Restarting polling due to background pause');
        this.updateMonitoredStationsAndPoll(this.activeDivaMapForPolling, this._shouldFetchWalkingTimesGlobal, true); // Pass shouldFetchWalkingTimesGlobal and forceRestart
        return;
      }

      // If the interval has changed, restart polling to use the new interval
      if (previousInterval !== this.pollingIntervalMs && this.activeDivaMapForPolling.size > 0) {
        console.log(`[MapView] Polling interval changed from ${previousInterval / 1000}s to ${this.pollingIntervalMs / 1000}s, restarting polling`);
        if (this.pollingSubscription) {
          this.pollingSubscription.unsubscribe();
          this.pollingSubscription = undefined;
        }
        this.updateMonitoredStationsAndPoll(this.activeDivaMapForPolling, this._shouldFetchWalkingTimesGlobal, true); // Pass shouldFetchWalkingTimesGlobal and forceRestart
      }
    }
  };


  isLoading = true;
  hasLocationError = false;
  private locationErrorSubscription: Subscription | null = null;
  showMetroLines = true;
  showStations = false; // Stations will be hidden initially

  private snackBar = inject(MatSnackBar);
  private mapsService = inject(GoogleMapsService);
  private apiService = inject(ApiService);
  private locationService = inject(LocationService);

  // Declare the visibility change handler as a property to avoid TypeScript errors
  private handleVisibilityChange = (): void => {
    const wasActive = this.isActivelyViewing;
    this.isActivelyViewing = document.visibilityState === 'visible';
    console.log(`[MapView] Visibility changed: User is ${this.isActivelyViewing ? 'actively viewing' : 'not viewing'} the app`);

    if (!wasActive && this.isActivelyViewing) {
      // Coming back to foreground from background
      console.log('[MapView] App returning to foreground, ensuring polling is active');

      // Check if polling is inactive but should be active
      if (this.activeDivaMapForPolling.size > 0 &&
          (this.pollingSubscription === undefined ||
           this.pollingPausedInBackground ||
           (this.pollingSubscription && this.pollingSubscription.closed))) {
        console.log('[MapView] Restarting polling subscription after returning to foreground');
        this.pollingPausedInBackground = false; // Reset the flag
        this.updateMonitoredStationsAndPoll(this.activeDivaMapForPolling, true); // Force restart
        return; // updateMonitoredStationsAndPoll already calls updatePollingInterval
      }
    }

    // In all other cases, just update the interval
    this.updatePollingInterval();
  };

  constructor() {
    // Set up visibility change detection for adaptive polling
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

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
    this.nearbyStationOverlays.forEach(overlay => overlay.destroy());
    this.nearbyStationOverlays.clear(); // Clear the map
    this.nearbyStationHighlightMarkers.forEach(marker => marker.setMap(null));
    this.nearbyStationHighlightMarkers.clear(); // Clear the map
    if (this.clickedStationOverlay) {
      this.clickedStationOverlay.destroy();
      this.clickedStationOverlay = null;
    }
    if (this.clickedStationHighlightMarker) {
        this.clickedStationHighlightMarker.setMap(null);
        this.clickedStationHighlightMarker = null;
    }

    this.stopPolling$.next();
    this.stopPolling$.complete();
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
    if (this.walkingTimeUpdateSubscription) {
      this.walkingTimeUpdateSubscription.unsubscribe();
    }
    if (this.locationErrorSubscription) {
      this.locationErrorSubscription.unsubscribe();
    }

    this.clearMetroLines();
    this.clearStationMarkers();

    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
  }

  private initializeMapWhenReady(): void {
    if (this.mapsService.isGoogleMapsLoaded() && window.google && window.google.maps && window.google.maps.geometry) {
      console.log('Google Maps API and Geometry library are loaded, initializing map and CustomMapOverlayCtor...');
      this.initializeCustomMapOverlayCtor();
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
    // Subscription to handle the availability of the location service
    this.locationService.locationAvailable$.pipe(
      takeUntil(this.componentDestroyed$)
    ).subscribe(isAvailable => {
      const previousErrorState = this.hasLocationError;
      this.hasLocationError = !isAvailable;

      if (isAvailable && previousErrorState) {
        console.log('[MapView] Location service is now available after being unavailable.');
        this.isLoading = false; // Assuming coordinates$ will provide the fix
        // Clear any specific retry logic if it was running
        if (this.locationErrorSubscription) {
          this.locationErrorSubscription.unsubscribe();
          this.locationErrorSubscription = null;
        }
      } else if (!isAvailable && !this.locationErrorSubscription) {
        console.log('[MapView] Location service is unavailable, setting up error handling.');
        this.setupLocationErrorHandling();
      }
    });

    // Subscription to handle continuous coordinate updates
    this.locationService.currentLocation$.pipe(
      takeUntil(this.componentDestroyed$),
      filter((coordinates): coordinates is Coordinates => coordinates !== null && coordinates.timestamp !== undefined) // Ensure timestamp is present
    ).subscribe({
      next: (coordinates: Coordinates) => {
        if (!this.map || !google || !google.maps || !google.maps.geometry || !google.maps.geometry.spherical) {
          console.warn('[MapView] Map or Google Maps Geometry library not available for location update.');
          return;
        }

        const newUserLatLng = new google.maps.LatLng(coordinates.latitude, coordinates.longitude);
        const newLocationTimestamp = coordinates.timestamp!;

        // Calculate speed if we have a previous location and timestamp
        if (this.lastKnownLocationForSpeed) {
          const oldLatLng = this.lastKnownLocationForSpeed.latLng;
          const oldTimestamp = this.lastKnownLocationForSpeed.timestamp;

          const distanceMoved = google.maps.geometry.spherical.computeDistanceBetween(oldLatLng, newUserLatLng);
          const timeElapsedMs = newLocationTimestamp - oldTimestamp;

          let currentSpeedMps = 0;
          if (timeElapsedMs > 0) {
            currentSpeedMps = distanceMoved / (timeElapsedMs / 1000); // meters per second
          }
          console.log(`[MapView] Speed calculation: Distance: ${distanceMoved.toFixed(2)}m, Time: ${timeElapsedMs}ms, Speed: ${currentSpeedMps.toFixed(2)} m/s`);

          // Decide if we should fetch walking times based on speed
          const shouldFetchWalkingTimes = currentSpeedMps <= this.WALKING_SPEED_THRESHOLD_MPS;

          // Update the last known location for speed calculation
          this.lastKnownLocationForSpeed = { latLng: newUserLatLng, timestamp: newLocationTimestamp };

          // Now proceed with the existing logic, passing `shouldFetchWalkingTimes`
          this.processLocationUpdate(coordinates, shouldFetchWalkingTimes); // New helper to encapsulate logic

        } else {
          // First location update, just store it and process with walking times enabled
          this.lastKnownLocationForSpeed = { latLng: newUserLatLng, timestamp: newLocationTimestamp };
          this.processLocationUpdate(coordinates, true); // Assume walking speed for initial fix
        }
      },
      error: (error: any) => {
        console.error('[MapView] Error receiving continuous location updates:', error);
        this.hasLocationError = true;
        this.isLoading = false;
        // locationAvailable$ should also emit false, triggering setupLocationErrorHandling if needed.
      }
    });
  }

  private _originalSubscribeToLocationUpdatesPlaceholder(): void {

    // Main subscription for location updates and processing
    this.locationService.currentLocation$.pipe(
      takeUntil(this.componentDestroyed$),
      switchMap((coordinates: Coordinates | null) => {
        if (!coordinates) {
          console.error('No location coordinates available');
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
        return this.fetchAndDisplayNearbySteige(coordinates, this._shouldFetchWalkingTimesGlobal);
      })
    ).subscribe({
      next: () => {
        console.log('Nearby Steige processing logic completed (or skipped if no coords).');
      },
      error: (error: any) => {
        console.error('MapViewComponent error during location update or Steige fetching:', error);
        this.hasLocationError = true;
        this.isLoading = false;
        this.setupLocationErrorHandling();
        const message = error?.message || 'Could not process location or fetch data.';
        this.snackBar.open(`Error: ${message}`, 'Close', { duration: 5000 });
      }
    });

    // Set up automatic recovery from location errors
    this.setupLocationErrorHandling();
  }

  private setupLocationErrorHandling(): void {
    // Clean up any existing subscription
    if (this.locationErrorSubscription) {
      this.locationErrorSubscription.unsubscribe();
      this.locationErrorSubscription = null;
    }

    // Set up periodic check for location recovery when location error is active
    this.locationErrorSubscription = interval(10000) // Check every 10 seconds
      .pipe(
        takeUntil(this.componentDestroyed$)
      )
      .subscribe(() => {
        if (this.hasLocationError) {
          console.log('Attempting to recover location access...');
          // Try to restart the location tracking
          this.locationService.retryLocationAccess();
        } else {
          // If we somehow still have this subscription active but no error,
          // clean it up to avoid unnecessary retries
          console.log('Location recovery subscription active but no error, cleaning up');
          if (this.locationErrorSubscription) {
            this.locationErrorSubscription.unsubscribe();
            this.locationErrorSubscription = null;
          }
        }
      });
  }

  // Encapsulate location update processing logic to be called from subscribe
  private processLocationUpdate(coordinates: Coordinates, shouldFetchWalkingTimes: boolean): void {
    const newUserLatLng = new google.maps.LatLng(coordinates.latitude, coordinates.longitude);

    // Store the global state for walking time fetching
    const previousShouldFetchWalkingTimes = this._shouldFetchWalkingTimesGlobal;
    this._shouldFetchWalkingTimesGlobal = shouldFetchWalkingTimes;

    // Initialize lastWalkingTimeUpdateLocation if it's null and we should fetch walking times
    if (!this.lastWalkingTimeUpdateLocation && shouldFetchWalkingTimes) {
      console.log('[MapView] Initializing lastWalkingTimeUpdateLocation');
      this.lastWalkingTimeUpdateLocation = newUserLatLng;
    }

    // If we're transitioning from not fetching to fetching walking times, trigger an immediate update
    if (!previousShouldFetchWalkingTimes && shouldFetchWalkingTimes) {
      console.log('[MapView] Speed dropped below threshold, re-enabling walking time updates');
      this.lastWalkingTimeUpdateLocation = newUserLatLng; // Update to current location
    }

    // Check if the received location is the exact same as the last one we processed
    if (this.lastProcessedLocationLatLng && newUserLatLng.equals(this.lastProcessedLocationLatLng)) {
      console.log('[MapView] Received same location as last processed. Skipping redundant update.');
      return;
    }

    if (!this.userMarker) {
      console.log('[MapView] First location fix, creating user marker and centering map.');
      this.userMarker = new google.maps.Marker({
        position: newUserLatLng,
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
      this.map.setCenter(newUserLatLng);
      this.map.setZoom(15); // Default zoom for first fix
      this.isLoading = false;
      this.hasLocationError = false; // Clear any previous error state

      // Initialize lastWalkingTimeUpdateLocation for first fix
      if (shouldFetchWalkingTimes) {
        this.lastWalkingTimeUpdateLocation = newUserLatLng;
      }

      this.fetchAndDisplayNearbySteige(coordinates, shouldFetchWalkingTimes) // Initial fetch
        .pipe(takeUntil(this.componentDestroyed$))
        .subscribe({
          error: (err) => console.error('[MapView] Error fetching nearby Steige on initial location:', err)
        });
      
      // Update the last processed location after the initial fetch
      this.lastProcessedLocationLatLng = newUserLatLng;

    } else {
      this.userMarker.setPosition(newUserLatLng);

      // Only re-fetch nearby steige and walking times if:
      // 1. The location has genuinely changed by more than 50m, OR
      // 2. We're transitioning from not fetching to fetching walking times
      if (!this.lastProcessedLocationLatLng || 
          google.maps.geometry.spherical.computeDistanceBetween(newUserLatLng, this.lastProcessedLocationLatLng) > 50 ||
          (!previousShouldFetchWalkingTimes && shouldFetchWalkingTimes)) {
        console.log('[MapView] Location changed significantly or walking times re-enabled. Re-fetching nearby Steige and walking times.');
        
        // Update lastWalkingTimeUpdateLocation if we're fetching walking times
        if (shouldFetchWalkingTimes) {
          this.lastWalkingTimeUpdateLocation = newUserLatLng;
        }
        
        this.fetchAndDisplayNearbySteige(coordinates, shouldFetchWalkingTimes)
          .pipe(takeUntil(this.componentDestroyed$))
          .subscribe({
            error: (err) => console.error('[MapView] Error fetching nearby Steige after location change:', err)
          });
        // Update the last processed location only if a fetch was triggered
        this.lastProcessedLocationLatLng = newUserLatLng;
      } else {
        console.log('[MapView] Location changed but not by more than 50m. Skipping nearby Steige fetch.');
      }

      // If there's a significant jump, also pan and reset zoom, but the data fetch is already triggered.
      if (this.previousUserLocation) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(this.previousUserLocation, newUserLatLng);
        if (distance > 1000) { // More than 1 km
          console.log(`[MapView] Large location jump detected (${Math.round(distance)}m). Recenter map with panTo.`);
          this.map.panTo(newUserLatLng);
          this.map.setZoom(15);

          // Clear existing highlights and overlays immediately after pan
          this.clearHighlightsAndOverlays();

          // For mobile view, we'll handle overlay selection after nearby stations are fetched
          if (this.isMobile) {
            this.activeMobileOverlayStationId = null;
          }
        }
      }
    }
    
    this.previousUserLocation = newUserLatLng; // Keep this for large jump pan/zoom logic
  }

  private fetchAndDisplayNearbySteige(coordinates: Coordinates, shouldFetchWalkingTimes: boolean): Observable<void> {
    console.log(`[MapView] Fetching nearby Steige for highlighting and overlay display (shouldFetchWalkingTimes: ${shouldFetchWalkingTimes}):`, coordinates);

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
          if (s.fk_haltestellen_id && typeof s.fk_haltestellen_id === 'number' && s.haltestellen_diva) {
            if (!uniqueHaltestellenDivaMap.has(s.fk_haltestellen_id)) {
              uniqueHaltestellenDivaMap.set(s.fk_haltestellen_id, s.haltestellen_diva);
            }
          } else if (s.fk_haltestellen_id && typeof s.fk_haltestellen_id === 'number' && !s.haltestellen_diva) {
            console.warn(`[MapView] NearbySteig for Haltestelle ID ${s.fk_haltestellen_id} (Steig ID: ${s.steig_id}) is missing 'haltestellen_diva'. This Steig will not be monitored for real-time data.`);
          }
        });

        const divaValuesToFetch = Array.from(uniqueHaltestellenDivaMap.values());
        console.log('[MapView] Unique DIVA values for real-time fetch:', divaValuesToFetch);

        // First, update polling and show markers for all stations
        this.updateMonitoredStationsAndPoll(uniqueHaltestellenDivaMap, shouldFetchWalkingTimes);
        
        // Create markers for all stations immediately
        this.createMarkersForStations(uniqueHaltestellenDivaMap);

        // If we should fetch walking times, do it now
        if (shouldFetchWalkingTimes && this.userMarker && this.userMarker.getPosition()) {
          const userLocation = this.userMarker.getPosition()!;
          const stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[] = [];
          
          uniqueHaltestellenDivaMap.forEach((_diva, stationId) => {
            const stationData = this.stationMarkerMap.get(stationId);
            if (stationData?.marker && stationData.marker.getPosition()) {
              const pos = stationData.marker.getPosition()!;
              stationTargets.push({ stationId, latLng: { lat: pos.lat(), lng: pos.lng() } });
            }
          });

          if (stationTargets.length > 0) {
            this.fetchAndStoreWalkingTimes(
              { lat: userLocation.lat(), lng: userLocation.lng() },
              stationTargets,
              true
            ).subscribe(() => {
              // After walking times are fetched, show overlays for the 3 closest stations
              this.createOverlaysForStations(uniqueHaltestellenDivaMap, null, true);
            });
          }
        }

        // After fetching nearby stations, if we're on mobile and had a location jump,
        // find and display the station with shortest walking time
        if (this.isMobile && this.activeMobileOverlayStationId === null) {
          const stationWithShortestTime = this.findStationWithShortestWalkingTime();
          if (stationWithShortestTime !== null) {
            this.activeMobileOverlayStationId = stationWithShortestTime;
            console.log(`[MapView] After fetching nearby stations, selected station with shortest walking time: ${stationWithShortestTime}`);
            // Clear existing overlays and recreate them to show the new active one
            this.clearHighlightsAndOverlays();
            this.createOverlaysForStations(uniqueHaltestellenDivaMap, null, true);
          }
        }
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

  private createMarkersForStations(stationDivaMap: Map<number, string | number>): void {
    console.log('[MapView] Creating markers for stations:', Array.from(stationDivaMap.keys()));

    // Find stations that are no longer in the map
    const stationsToRemove = new Set<number>();
    this.nearbyStationHighlightMarkers.forEach((_, stationId) => {
      if (!stationDivaMap.has(stationId)) {
        stationsToRemove.add(stationId);
      }
    });

    // Remove markers for stations that are no longer in the map
    stationsToRemove.forEach(stationId => {
      const marker = this.nearbyStationHighlightMarkers.get(stationId);
      if (marker) {
        marker.setMap(null);
        this.nearbyStationHighlightMarkers.delete(stationId);
        this.highlightedStationIds.delete(stationId);
        console.log(`[MapView] Removed marker for station ${stationId} (no longer in map).`);
      }
    });

    // Create or update markers for all stations in the map
    stationDivaMap.forEach((_diva, stationId) => {
      const stationData = this.stationMarkerMap.get(stationId);
      if (!stationData?.marker) return;

      const originalStationMarker = stationData.marker;
      const position = originalStationMarker.getPosition()!;

      // Create or update highlight marker
      let highlightMarker: google.maps.Marker;
      if (stationId === this.clickedStationId) {
        highlightMarker = this.clickedStationHighlightMarker || this.createHighlightMarker(stationId, originalStationMarker);
        this.clickedStationHighlightMarker = highlightMarker;
      } else {
        highlightMarker = this.nearbyStationHighlightMarkers.get(stationId) || this.createHighlightMarker(stationId, originalStationMarker);
        this.nearbyStationHighlightMarkers.set(stationId, highlightMarker);
      }

      // Update marker appearance and visibility
      highlightMarker.setMap(this.map);
      const newFillColor = stationId === this.clickedStationId ? '#ADD8E6' : '#6495ED';
      const currentIcon = highlightMarker.getIcon() as google.maps.Symbol;
      if (currentIcon && currentIcon.fillColor !== newFillColor) {
        highlightMarker.setIcon({
          ...currentIcon,
          fillColor: newFillColor
        });
      }

      // Add click listener
      google.maps.event.clearListeners(highlightMarker, 'click');
      highlightMarker.addListener('click', () => {
        if (this.isMobile) {
          if (this.activeMobileOverlayStationId === stationId) return;
          this.activeMobileOverlayStationId = stationId;
          console.log('[MapView] Mobile overlay station changed to:', stationId);
          this.createOverlaysForStations(stationDivaMap, null, true);
        } else {
          this.handleStationClick(stationId);
        }
      });
    });

    // Clean up clicked station if it's no longer the clicked one
    if (this.clickedStationId === null) {
      if (this.clickedStationHighlightMarker) {
        this.clickedStationHighlightMarker.setMap(null);
        this.clickedStationHighlightMarker = null;
      }
    }
  }

  private updateMonitoredStationsAndPoll(
    divaMapToUpdate: Map<number, string | number>,
    shouldFetchWalkingTimes: boolean,
    forceRestart: boolean = false
  ): void {
    // Combine nearby stations with the clicked station (if any)
    const combinedDivaMap = new Map<number, string | number>([...divaMapToUpdate]);

    // Add clicked station to the polling request if one exists
    if (this.clickedStationId !== null && this.clickedStationDiva !== null) {
      combinedDivaMap.set(this.clickedStationId, this.clickedStationDiva);
    }

    const newDivaValues = Array.from(combinedDivaMap.values());
    const newPollingKey = this.generatePollingKey(combinedDivaMap);

    console.log('[MapView] Polling state:', {
      newPollingKey,
      currentPollingKey: this.currentPollingDivasKey,
      forceRestart,
      shouldFetchWalkingTimes,
      hasDivas: newDivaValues.length > 0,
      walkingTimesSize: this.stationWalkingTimes.size,
      cacheSize: this.nearbyStationCache.size
    });

    // Only skip polling restart if DIVAs unchanged AND not fetching walking times
    if (!forceRestart && this.currentPollingDivasKey === newPollingKey && newDivaValues.length > 0 && !shouldFetchWalkingTimes) {
      console.log('[MapView] Monitored DIVAs unchanged and no walking time fetch needed, polling continues for key:', newPollingKey);
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

    const oldNearbyPollingKey = this.generatePollingKey(this.activeDivaMapForPolling);
    const newNearbyPollingKey = this.generatePollingKey(divaMapToUpdate);

    // Store walking times before clearing
    const oldWalkingTimes = new Map(this.stationWalkingTimes);

    if (forceRestart || oldNearbyPollingKey !== newNearbyPollingKey) {
      console.log('[MapView] Nearby station set changed or forceRestart. Updating overlays.');
      
      // Find stations that are no longer nearby
      const stationsToRemove = new Set<number>();
      this.nearbyStationOverlays.forEach((_, stationId) => {
        if (!divaMapToUpdate.has(stationId)) {
          stationsToRemove.add(stationId);
        }
      });

      // Remove overlays only for stations that are no longer nearby
      stationsToRemove.forEach(stationId => {
        const overlay = this.nearbyStationOverlays.get(stationId);
        if (overlay) {
          overlay.destroy();
          this.nearbyStationOverlays.delete(stationId);
          console.log(`[MapView] Removed overlay for station ${stationId} (no longer nearby).`);
        }
      });

      // Only create overlays if we have walking times
      if (this.stationWalkingTimes.size > 0) {
        this.createOverlaysForStations(divaMapToUpdate, this.lastMonitorResponse, true);
          } else {
        console.log('[MapView] Waiting for walking times before creating overlays');
          }
    }

    this.currentPollingDivasKey = newPollingKey;
    this.activeDivaMapForPolling = new Map(combinedDivaMap);

    // Restore walking times
    this.stationWalkingTimes = oldWalkingTimes;

    this.lastETag = null;

    if (newDivaValues.length === 0) {
      console.log('[MapView] No DIVAs to monitor. Clearing overlays and stopping poll.');
      this.clearHighlightsAndOverlays();
      return;
    }

    console.log(`[MapView] Starting new data fetch for DIVAs: ${newDivaValues.join(', ')}`);

    // Start polling immediately
    this.startPolling(newDivaValues);

    // Handle walking times separately
    const userLocation = this.userMarker ? this.userMarker.getPosition() : null;
    let userLocationLiteral: google.maps.LatLngLiteral | null = null;
    if (userLocation) {
      userLocationLiteral = { lat: userLocation.lat(), lng: userLocation.lng() };
    }

    const stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[] = [];
    this.activeDivaMapForPolling.forEach((_diva, stationId) => {
      // Only include stations that are *not* the currently clicked station for walking times
      if (stationId !== this.clickedStationId) {
        const stationData = this.stationMarkerMap.get(stationId);
        if (stationData?.marker && stationData.marker.getPosition()) {
          const pos = stationData.marker.getPosition()!;
          stationTargets.push({ stationId, latLng: { lat: pos.lat(), lng: pos.lng() } });
        }
      }
    });

    console.log('[MapView] Station targets:', stationTargets);
    console.log('[MapView] User location literal:', userLocationLiteral);
    console.log('[MapView] Should fetch walking times:', shouldFetchWalkingTimes);

    // Only fetch walking times if explicitly requested or if we don't have any walking times yet
    const shouldFetchWalkingTimesNow = shouldFetchWalkingTimes || this.stationWalkingTimes.size === 0;
    if (userLocationLiteral && stationTargets.length > 0 && shouldFetchWalkingTimesNow) {
      this.fetchAndStoreWalkingTimes(userLocationLiteral, stationTargets, shouldFetchWalkingTimes)
        .subscribe(() => {
          // After walking times are fetched, update overlays
          this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse, true);
        });
    }
  }

  private startPolling(newDivaValues: (string | number)[]): void {
    // Determine optimal polling interval based on context
    this.updatePollingInterval();

    console.log(`[MapView] Setting up polling with interval: ${this.pollingIntervalMs}ms (${this.pollingIntervalMs / 1000}s)`);

    this.pollingSubscription = timer(0, this.pollingIntervalMs).pipe(
      takeUntil(this.stopPolling$),
      exhaustMap(() => {
        this.updatePollingInterval();

        console.log('[MapView] Fetching real-time data for stations:', newDivaValues);

        // Include ETag header if available to support 304 Not Modified responses
        const headers: Record<string, string> = {};
        if (this.lastETag) {
          headers['If-None-Match'] = this.lastETag;
        }

        return this.apiService.getRealTimeDepartures(newDivaValues, headers).pipe(
          tap((response: any) => {
            console.log('[MapView] Raw API response:', response);
            
            // Check if this is a 304 Not Modified response
            if (response && response.status === 304) {
              console.log(`[MapView] Received 304 Not Modified - using cached data`);
              return;
            }

            if (response?.headers?.etag) {
              this.lastETag = response.headers.etag;
              console.log(`[MapView] Stored new ETag: ${this.lastETag}`);
            }

            if (response?.data?.monitors) {
              console.log(`[MapView] Received monitor data with ${response.data.monitors.length} station groups`);
              // Log the metro lines received for debugging
              let metroLineCount = 0;
              response.data.monitors.forEach((monitor: { lines?: Array<any> }) => {
                if (monitor.lines) {
                  metroLineCount += monitor.lines.length;
                }
              });
              console.log(`[MapView] Total metro lines received: ${metroLineCount}`);
            } else {
              console.warn('[MapView] Received response without monitors data:', response);
            }
          }),
          catchError((err: any) => {
            console.error('[MapView] Error fetching monitor data:', err);
            this.isLoadingClickedStationData = false;
            this.clearHighlightsAndOverlays();
            this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse, true);
            this.lastMonitorResponse = null;
            return of(null);
          })
        );
      })
    ).subscribe((monitorResponse: MonitorApiResponse | null) => {
      console.log('[MapView] Processing monitor response:', monitorResponse);

      if ((monitorResponse as any)?.status === 304) {
        console.log('[MapView] Using cached data (304 Not Modified)');
        return;
      }

      if (!monitorResponse) {
        console.warn('[MapView] No monitor response received');
        return;
      }

      const monitors = monitorResponse.data?.monitors;
      if (!monitors) {
        console.warn('[MapView] No monitors data in response:', monitorResponse);
        return;
      }

      this.lastMonitorResponse = monitorResponse;
      console.log("[MapView] Processing monitor data:", {
        monitorCount: monitors.length,
        activeDivaMap: this.activeDivaMapForPolling,
        monitors: monitors
      });
        
        // Update existing overlays with new data instead of recreating them
        this.activeDivaMapForPolling.forEach((_diva, stationId) => {
          const stationData = this.stationMarkerMap.get(stationId);
        if (!stationData) {
          console.log(`[MapView] No station data found for station ${stationId}`);
          return;
        }

          const stationName = stationData.marker.get('title') as string;
          const overlay = stationId === this.clickedStationId ? 
            this.clickedStationOverlay : 
            this.nearbyStationOverlays.get(stationId);

          if (overlay) {
            // Use old walking time if available, otherwise get from current map
          const walkingTime = this.stationWalkingTimes.get(stationId);
            const validLineBezeichnungen = new Set<string>();
            
            // Find the monitor data for this station
            const stationMonitor = monitors.find(
            (monitor: any) => {
              const monitorName = monitor.locationStop?.properties?.name;
              console.log(`[MapView] Comparing monitor ${monitorName} with DIVA ${_diva}`);
              return monitorName === String(_diva);
            }
            );

          if (stationMonitor) {
            console.log(`[MapView] Found monitor data for station ${stationId}:`, stationMonitor);
          } else {
            console.log(`[MapView] No monitor data found for station ${stationId} with DIVA ${_diva}`);
          }

            // Extract valid line bezeichnungen from the monitor data
            if (stationMonitor?.lines) {
              stationMonitor.lines.forEach((line: any) => {
                if (line.name) {
                  validLineBezeichnungen.add(line.name);
                }
              });
            }

            // Create a new monitor response with just this station's data
            const stationMonitorResponse: MonitorApiResponse = {
              message: monitorResponse.message,
              data: {
                monitors: stationMonitor ? [stationMonitor] : []
              }
            };

            // Cache the data for all stations
            this.nearbyStationCache.set(stationId, stationMonitorResponse);
            console.log(`[MapView] Cached data for station ${stationId}:`, {
              hasMonitorData: !!stationMonitor,
              lineCount: stationMonitor?.lines?.length || 0,
              cacheSize: this.nearbyStationCache.size,
              diva: _diva,
              cacheContents: stationMonitorResponse,
              monitors: stationMonitorResponse?.data?.monitors || []
            });

            // Only update loading state for clicked station
            if (stationId === this.clickedStationId) {
              this.isLoadingClickedStationData = false;
              console.log('[MapView] Updated clicked station overlay with new data');
            }

            const content = this.generateOverlayContentHtml(
              stationName,
              stationId,
              _diva,
              stationMonitor ? stationMonitorResponse : null,
              validLineBezeichnungen,
              walkingTime,
              stationId === this.clickedStationId,
              stationId === this.clickedStationId ? this.isLoadingClickedStationData : false
            );

            // Get the marker position for repositioning
            const position = stationData.marker.getPosition()!;
            this.updateOverlayContent(overlay, content, position);
      } else {
          console.log(`[MapView] No overlay found for station ${stationId}`);
        }
      });

      // After processing the response, update the polling interval
      this.updatePollingInterval();
    });
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
      // Initialize lastWalkingTimeUpdateLocation if it's null
      this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(
        currentUserLocation.lat(),
        currentUserLocation.lng()
      );
      console.log('[MapView] Initialized lastWalkingTimeUpdateLocation to:', this.lastWalkingTimeUpdateLocation.toString());
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

    // Check if we need to re-enable walking time fetching (even if user hasn't moved)
    let shouldFetchWalkingTimes = false;
    if (!this._shouldFetchWalkingTimesGlobal) {
      console.log('[MapView] Walking time fetching was disabled, checking if we should re-enable it');
      // Re-enable walking time fetching
      this._shouldFetchWalkingTimesGlobal = true;
      this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(
        currentUserLocation.lat(),
        currentUserLocation.lng()
      );
      console.log('[MapView] Re-enabled walking time fetching and reset lastWalkingTimeUpdateLocation');
      shouldFetchWalkingTimes = true; // Force a fetch when re-enabling
    }

    if (distanceMoved > this.MIN_MOVEMENT_DISTANCE_FOR_WALKING_UPDATE_M || shouldFetchWalkingTimes) {
      console.log('[MapView] User moved significantly or walking times were re-enabled. Fetching updated walking times.');
      const stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[] = [];
      this.activeDivaMapForPolling.forEach((_diva, stationId) => {
        // Only include stations that are *not* the currently clicked station for walking times
        if (stationId !== this.clickedStationId) {
          const stationData = this.stationMarkerMap.get(stationId);
          if (stationData?.marker && stationData.marker.getPosition()) {
            const pos = stationData.marker.getPosition()!;
            stationTargets.push({ stationId, latLng: { lat: pos.lat(), lng: pos.lng() } });
          }
        }
      });

      if (stationTargets.length > 0) {
        // Update the last walking time update location before fetching new times
        this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(
          currentUserLocation.lat(),
          currentUserLocation.lng()
        );
        console.log('[MapView] Updated lastWalkingTimeUpdateLocation before fetch:', this.lastWalkingTimeUpdateLocation.toString());

        // Fetch new walking times
        this.fetchAndStoreWalkingTimes(
          { lat: currentUserLocation.lat(), lng: currentUserLocation.lng() },
          stationTargets,
          this._shouldFetchWalkingTimesGlobal
        );
      } else {
        // If no nearby stations, clear walking times but keep lastWalkingTimeUpdateLocation
        this.stationWalkingTimes.clear();
        console.log('[MapView] No stations to update, keeping lastWalkingTimeUpdateLocation:', this.lastWalkingTimeUpdateLocation.toString());
        this.clearHighlightsAndOverlays();
        this.createOverlaysForStations(this.activeDivaMapForPolling, this.lastMonitorResponse);
      }
    } else {
      console.log('[MapView] User has not moved significantly. No walking time update needed.');
    }
  }

  private fetchAndStoreWalkingTimes(
    userLocationLiteral: google.maps.LatLngLiteral,
    stationTargets: { stationId: number; latLng: google.maps.LatLngLiteral }[],
    shouldFetchWalkingTimes: boolean
  ): Observable<void> {
    if (!shouldFetchWalkingTimes || this.isFetchingWalkingTimes) {
      return of(void 0);
    }

    this.isFetchingWalkingTimes = true;
    const payload = {
      origins: [userLocationLiteral],
      destinations: stationTargets.map(target => target.latLng)
    };

    console.log('[MapView] Walking time fetch Payload:', payload);

    return this.apiService.getSecureWalkingMatrix(payload).pipe(
      tap(response => {
        if (!response?.rows?.[0]?.elements) {
            return;
          }
            console.log('[MapView] Updated lastWalkingTimeUpdateLocation to:', userLocationLiteral);
        const walkingTimes = new Map<number, number>();
        response.rows[0].elements.forEach((element: { duration: { value: number } }, index: number) => {
          const stationId = stationTargets[index].stationId;
          const durationInMinutes = Math.ceil(element.duration.value / 60);
          walkingTimes.set(stationId, durationInMinutes);
        });
        console.log('[MapView] Walking times fetched/updated via backend:', walkingTimes);
        this.stationWalkingTimes = walkingTimes;
        this.lastWalkingTimeUpdateLocation = new google.maps.LatLng(
          userLocationLiteral.lat,
          userLocationLiteral.lng
        );
        }),
      catchError(error => {
        console.error('[MapView] Error fetching walking times:', error);
        return of(void 0);
      }),
      finalize(() => {
        this.isFetchingWalkingTimes = false;
      })
      );
  }

  private clearHighlightsAndOverlays(scope: 'all' | 'nearby' | 'clicked' = 'all'): void {
    console.log(`[MapView] Clearing ${scope} station highlights and overlays. Count: ${this.nearbyStationOverlays.size}`);

    if (scope === 'all' || scope === 'nearby') {
      // Clear overlays but preserve markers
      this.nearbyStationOverlays.forEach(overlay => {
        overlay.destroy();
      });
      this.nearbyStationOverlays.clear();
      this.highlightedStationIds.clear();
    }

    if (scope === 'all' || scope === 'clicked') {
      if (this.clickedStationOverlay) {
        this.clickedStationOverlay.destroy();
        this.clickedStationOverlay = null;
      }
      if (this.clickedStationHighlightMarker) {
        this.clickedStationHighlightMarker.setMap(null);
        this.clickedStationHighlightMarker = null;
      }
      this.clickedStationId = null;
      this.clickedStationDiva = null;
    }
  }

  private initializeCustomMapOverlayCtor(): void {
    this.CustomMapOverlayCtor = createCustomMapOverlayClass(google.maps);
  }

  private selectStationsForOverlays(
    stationDivaMap: Map<number, string | number>,
    maxStations: number,
    clickedStationId: number | null = null
  ): Set<number> {
    console.log(`[MapView] Selecting up to ${maxStations} stations for overlays from ${stationDivaMap.size} nearby stations`);

    // If we're on mobile and have an active station, only show that one
    if (this.isMobile && this.activeMobileOverlayStationId !== null) {
      return new Set([this.activeMobileOverlayStationId]);
    }

    // Create set of stations to show
    const stationsToShow = new Set<number>();
    
    // Always include clicked station if it exists
    if (clickedStationId !== null) {
      stationsToShow.add(clickedStationId);
    }

    // Get stations with walking times
    const stationsWithWalkingTimes = Array.from(stationDivaMap.keys())
        .map(stationId => ({
          stationId,
          walkingTime: this.stationWalkingTimes.get(stationId) ?? Number.POSITIVE_INFINITY
        }))
      .filter(station => station.stationId !== clickedStationId && station.walkingTime !== Number.POSITIVE_INFINITY)
      .sort((a, b) => a.walkingTime - b.walkingTime);

    // If we have monitor data with lines, use line-based selection
    if (this.lastMonitorResponse?.data?.monitors) {
      // Group stations by their lines
      const stationsByLine = new Map<string, { stationId: number; walkingTime: number }[]>();
      
      stationDivaMap.forEach((diva, stationId) => {
        const stationData = this.stationMarkerMap.get(stationId);
        if (!stationData?.marker) return;

        const walkingTime = this.stationWalkingTimes.get(stationId);
        if (walkingTime === undefined) return;

        // Get lines for this station from monitor data
        const monitorData = this.lastMonitorResponse?.data?.monitors?.find(
          monitor => monitor?.locationStop && 'diva' in monitor.locationStop && monitor.locationStop.diva === diva
        );

        if (monitorData?.lines?.length) {
          monitorData.lines.forEach(line => {
            if (!line?.name) return;
            const lineKey = line.name;
            if (!stationsByLine.has(lineKey)) {
              stationsByLine.set(lineKey, []);
            }
            stationsByLine.get(lineKey)!.push({ stationId, walkingTime });
          });
        }
      });

      // If we found stations with lines, use line-based selection
      if (stationsByLine.size > 0) {
        // For each line, find the station with shortest walking time
        const bestStationsByLine = new Map<string, { stationId: number; walkingTime: number }>();
        stationsByLine.forEach((stations, lineKey) => {
          const bestStation = stations.reduce((best, current) => 
            current.walkingTime < best.walkingTime ? current : best
          );
          bestStationsByLine.set(lineKey, bestStation);
        });

        // Convert to array and sort by walking time
        const sortedStations = Array.from(bestStationsByLine.values())
          .sort((a, b) => a.walkingTime - b.walkingTime);

        // Add stations up to maxStations (excluding clicked station)
        for (const station of sortedStations) {
          if (stationsToShow.size >= maxStations) break;
          if (station.stationId !== clickedStationId) {
            stationsToShow.add(station.stationId);
          }
        }
      } else {
        // If no stations have lines, use walking time based selection
        stationsWithWalkingTimes.slice(0, maxStations).forEach(station => 
          stationsToShow.add(station.stationId)
        );
            }
    } else {
      // If no monitor data, use walking time based selection
      stationsWithWalkingTimes.slice(0, maxStations).forEach(station => 
        stationsToShow.add(station.stationId)
      );
        }

    console.log('[MapView] Selected stations for overlays:', Array.from(stationsToShow));
    return stationsToShow;
    }

  private createOverlaysForStations(
    stationDivaMap: Map<number, string | number>,
    monitorResponse: MonitorApiResponse | null,
    showOverlays: boolean = true
  ): void {
    if (!this.map || !this.CustomMapOverlayCtor) {
      console.warn('[MapView] Map or CustomMapOverlayCtor not initialized');
      return;
    }

    console.log('[MapView] Creating overlays for stations:', Array.from(stationDivaMap.keys()));

    // Select stations to show based on walking times and monitor data
    const maxStations = this.isMobile ? 1 : 3;
    const stationsToShow = this.selectStationsForOverlays(stationDivaMap, maxStations);

    // Update overlays for selected stations
    this.updateOverlaysForStations(stationDivaMap, monitorResponse, stationsToShow);
  }

  private updateOverlaysForStations(
    stationDivaMap: Map<number, string | number>,
    monitorResponse: MonitorApiResponse | null,
    stationsToShow: Set<number>
  ): void {
    console.log('[MapView] Updating overlays for stations:', {
      stationsToShow: Array.from(stationsToShow),
      monitorResponse: monitorResponse ? 'present' : 'missing',
      stationDivaMap: Array.from(stationDivaMap.entries())
    });

    // Remove overlays for stations that are no longer in the map
    for (const [stationId, overlay] of this.nearbyStationOverlays) {
      if (!stationDivaMap.has(stationId)) {
        console.log(`[MapView] Removing overlay for station ${stationId} as it's no longer in the map`);
        overlay.setMap(null);
        this.nearbyStationOverlays.delete(stationId);
      }
    }

    // Create or update overlays for selected stations
    for (const [stationId, diva] of stationDivaMap) {
      const stationData = this.stationMarkerMap.get(stationId);
      if (!stationData?.marker) {
        console.warn(`[MapView] No marker found for station ${stationId}`);
        continue;
      }

      const position = stationData.marker.getPosition();
      if (!position) {
        console.warn(`[MapView] No position found for station ${stationId}`);
        continue;
      }

      // Find monitor data for this station
      let monitorData = null;
      if (monitorResponse?.data?.monitors) {
        for (const monitor of monitorResponse.data.monitors) {
          if (monitor?.locationStop && 'diva' in monitor.locationStop && monitor.locationStop.diva === diva) {
            monitorData = monitor;
            break;
          }
        }
      }

      const stationName = monitorData?.locationStop && 'name' in monitorData.locationStop && monitorData.locationStop.name ? 
        String(monitorData.locationStop.name) : 
        stationData.marker.getTitle() || 'Unknown Station';
      const walkingTime = this.stationWalkingTimes.get(stationId);

      // Generate content for the overlay
      const content = this.generateOverlayContentHtml(
        stationName,
        stationId,
        diva,
        monitorResponse,
        new Set(monitorData?.lines?.map(line => 'line' in line ? String(line.line) : '') || []),
        walkingTime,
        false,
        false
      );

      // Create or update overlay
      const existingOverlay = this.nearbyStationOverlays.get(stationId);
      if (!existingOverlay) {
        console.log(`[MapView] Creating new overlay for station ${stationId}`, {
          stationName,
          walkingTime,
          hasMonitorData: !!monitorData,
          shouldShow: stationsToShow.has(stationId)
        });
        const newOverlay = new this.CustomMapOverlayCtor(position, content);
        this.nearbyStationOverlays.set(stationId, newOverlay);
        
        // Only show overlay if it's in stationsToShow
        if (stationsToShow.has(stationId)) {
          newOverlay.setMap(this.map);
        } else {
          newOverlay.setMap(null);
        }
      } else {
        console.log(`[MapView] Updating overlay for station ${stationId}`, {
          stationName,
          walkingTime,
          hasMonitorData: !!monitorData,
          contentLength: content.length,
          shouldShow: stationsToShow.has(stationId)
        });
        this.updateOverlayContent(existingOverlay, content, position);
        
        // Only show overlay if it's in stationsToShow
        if (stationsToShow.has(stationId)) {
          existingOverlay.setMap(this.map);
        } else {
          existingOverlay.setMap(null);
        }
      }
    }
  }

  private generateOverlayContentHtml(
    stationName: string,
    stationId: number,
    divaValue: string | number | null,
    monitorResponse: MonitorApiResponse | null,
    validLineBezeichnungen: Set<string>,
    walkingTimeInMinutes: number | undefined,
    isClickedStationNow: boolean,
    isLoadingClickedStationData: boolean
  ): string {
    let realTimeHtml = '';

    if (isClickedStationNow && divaValue === null) {
      realTimeHtml = `<div class="status-message">Real-time data not available for this station.</div>`;
    } else if (isClickedStationNow && isLoadingClickedStationData) {
      realTimeHtml = `<div class="loading-message">Loading departures...</div>`;
    } else if (monitorResponse && (monitorResponse as any).errorOccurred) {
      realTimeHtml = `<div class="status-message">Error loading real-time data.</div>`;
    } else if ((monitorResponse === null || monitorResponse === undefined) && !isClickedStationNow && this.lastMonitorResponse) {
      // If no new monitorResponse, but we have a last successful one for a nearby station, use it
      return this.generateOverlayContentHtml(
        stationName,
        stationId,
        divaValue,
        this.lastMonitorResponse, // Use the last successful response
        validLineBezeichnungen,
        walkingTimeInMinutes,
        isClickedStationNow,
        isLoadingClickedStationData
      );
    } else if (monitorResponse === null || monitorResponse === undefined) {
      realTimeHtml = `<div class="loading-message">Loading real-time data...</div>`;
    } else if (monitorResponse.data?.monitors && Array.isArray(monitorResponse.data.monitors)) {
      const stationMonitor = monitorResponse.data.monitors.find(
        (m: Monitor) => {
          const divaMatch = m.locationStop.properties.name === String(divaValue);
          const rblMatch = m.locationStop.properties.attributes?.rbl === Number(divaValue);
          console.log(`[MapView] Checking monitor for station ${divaValue}:`, {
            monitorName: m.locationStop.properties.name,
            monitorRbl: m.locationStop.properties.attributes?.rbl,
            divaMatch,
            rblMatch
          });
          return divaMatch || rblMatch;
        }
      );

      if (stationMonitor) {
        console.log(`[MapView] Found monitor data for station ${divaValue}:`, stationMonitor);
        const departuresHtmlParts: string[] = [];
        if (stationMonitor.lines && Array.isArray(stationMonitor.lines)) {
          stationMonitor.lines.forEach((line: RealTimeMonitorLine) => {
            // Check if the line has departures and they are not empty
            if (line.departures?.departure && Array.isArray(line.departures.departure) && line.departures.departure.length > 0) {
              const firstDeparture = line.departures.departure[0];
              if (firstDeparture?.departureTime) {
                let lineColor = '#808080'; // Default gray color if not found
                if (this.lineStopsData && this.lineStopsData.lines) {
                  const linesArray = Object.values(this.lineStopsData.lines) as MetroLine[];
                  const metroLineDetails = linesArray.find(
                    (metroLine: MetroLine) => metroLine.bezeichnung === line.name
                  );
                  if (metroLineDetails && metroLineDetails.farbe) {
                    lineColor = metroLineDetails.farbe;
                  }
                }
                const lineNameHtml = `<div class="gm-line-badge" style="background-color: ${lineColor};">${line.name}</div>`;

                const getCountdownItemHtml = (countdown: number, isFirst: boolean): string => {
                  const itemClass = isFirst ? "line-countdown-item line-countdown-first" : "line-countdown-item";
                  if (countdown <= 0) {
                    return `<span class="${itemClass} line-countdown-now blinking-dots-container"><span class="blinking-dot dot1"></span><span class="blinking-dot dot2"></span></span>`;
                  }
                  return `<span class="${itemClass} line-countdown">${countdown}'</span>`;
                };

                let countdownsInnerHtml = getCountdownItemHtml(firstDeparture.departureTime.countdown, true);

                if (line.departures.departure.length > 1) {
                  const secondDeparture = line.departures.departure[1];
                  if (secondDeparture?.departureTime) {
                    countdownsInnerHtml += ` <span class="countdown-separator">|</span> ${getCountdownItemHtml(secondDeparture.departureTime.countdown, false)}`;
                  }
                }

                const countdownsWrapperHtml = `<span class="countdown-wrapper">${countdownsInnerHtml}</span>`;

                departuresHtmlParts.push(
                  `<div class="departure-line">` +
                  lineNameHtml +
                  ` <span class="material-icons line-direction-arrow-icon">chevron_right</span> ` +
                  `<span class="line-direction">${line.towards}</span> ` +
                  countdownsWrapperHtml +
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
        console.log(`[MapView] No monitor data found for station ${divaValue}`);
        realTimeHtml = `<div class="status-message">No departures found!</div>`;
      }
    } else {
      realTimeHtml = `<div class="status-message">Real-time data format error or empty response.</div>`;
    }

    const walkingTimeDisplayHtml = walkingTimeInMinutes !== undefined ? `
      <span class="walking-time-info">
        <span class="material-icons walking-time-icon">directions_walk</span>
        <span class="walking-time-value">${walkingTimeInMinutes}'</span>
      </span>` : '';

    const closeButtonHtml = isClickedStationNow ? `
      <button class="overlay-close-button" data-station-id="${stationId}" style="position: absolute; top: 8px; right: 8px; z-index: 1001; cursor: pointer; border: none; background: none; padding: 0; pointer-events: auto; display: flex; align-items: center; justify-content: center;">
        <span class="material-icons" style="font-size: 16px; color: #555; padding: 4px; border-radius: 50%; background-color: rgba(255,255,255,0.8);">close</span>
      </button>` : '';

    return `
      <div class="custom-map-overlay ${isClickedStationNow ? 'clicked-station-overlay' : ''}" style="position: relative; pointer-events: none; background: white; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); padding: 8px;">
        <div class="station-info-header" style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px; flex-grow: 1;">
            <span class="station-name-bold">${stationName}</span>
            ${walkingTimeDisplayHtml}
          </div>
          ${closeButtonHtml}
        </div>
        <div class="real-time-data">
          ${realTimeHtml}
        </div>
      </div>`;
  }

  private createHighlightMarker(
    stationId: number,
    originalStationMarker: google.maps.Marker
  ): google.maps.Marker {
    const originalIcon = originalStationMarker.getIcon() as google.maps.Symbol | null;
    const originalStrokeColor = (originalIcon && typeof originalIcon === 'object' && originalIcon.strokeColor) ? originalIcon.strokeColor : '#000000';

    const highlightMarker = new google.maps.Marker({
      position: originalStationMarker.getPosition(),
      map: this.map,
      title: originalStationMarker.getTitle(),
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: stationId === this.clickedStationId ? '#ADD8E6' : '#6495ED',
        fillOpacity: 1,
        strokeColor: originalStrokeColor,
        strokeWeight: originalIcon?.strokeWeight || 2
      },
      zIndex: google.maps.Marker.MAX_ZINDEX + 1
    });

    // Add click listener (will be handled in createOverlaysForStations logic now)
    return highlightMarker;
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

  private generatePollingKey(divaMap: Map<number, string | number>): string {
    if (!divaMap || divaMap.size === 0) {
      return '';
    }
    // Sort by stationId (key) first to ensure consistent key generation if values are numbers/strings
    const sortedEntries = Array.from(divaMap.entries()).sort(([a], [b]) => a - b);
    return sortedEntries.map(([, value]) => value).join(',');
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

        marker.addListener('click', () => this.handleStationClick(stationId));

        this.stationMarkers.push(marker);
        this.stationMarkerMap.set(stationId, { marker, diva });
      });
    });
  }

  private handleStationClick(stationId: number): void {
    console.log(`[MapView] Station clicked: ${stationId}`);
    
    // Clear any existing clicked station overlay
    if (this.clickedStationOverlay) {
      this.clickedStationOverlay.setMap(null);
      this.clickedStationOverlay = null;
    }

    // Clear any existing clicked station highlight marker
    if (this.clickedStationHighlightMarker) {
      this.clickedStationHighlightMarker.setMap(null);
      this.clickedStationHighlightMarker = null;
    }

    const stationData = this.stationMarkerMap.get(stationId);
    if (!stationData?.marker) {
      console.warn(`[MapView] No marker found for clicked station ${stationId}`);
      return;
    }

    const position = stationData.marker.getPosition();
    if (!position) {
      console.warn(`[MapView] No position found for clicked station ${stationId}`);
      return;
    }

    // Set the clicked station ID and DIVA
    this.clickedStationId = stationId;
    this.clickedStationDiva = stationData.diva ?? null;

    // Create highlight marker for clicked station
    this.clickedStationHighlightMarker = this.createHighlightMarker(stationId, stationData.marker);

    // Find existing monitor data for immediate display
    let existingMonitorData = null;
    if (this.lastMonitorResponse?.data?.monitors) {
      for (const monitor of this.lastMonitorResponse.data.monitors) {
        if (monitor?.locationStop && 'diva' in monitor.locationStop && monitor.locationStop.diva === stationData.diva) {
          existingMonitorData = monitor;
          break;
        }
      }
    }

    // Get station name from monitor data or marker title
    const stationName = existingMonitorData?.locationStop && 'name' in existingMonitorData.locationStop && existingMonitorData.locationStop.name ? 
      String(existingMonitorData.locationStop.name) : 
      stationData.marker.getTitle() || 'Unknown Station';

    // Get walking time
    const walkingTime = this.stationWalkingTimes.get(stationId);

    // Generate content for the overlay
    const content = this.generateOverlayContentHtml(
      stationName,
      stationId,
      stationData.diva ?? null,
      this.lastMonitorResponse,
      new Set(existingMonitorData?.lines?.map(line => 'line' in line ? String(line.line) : '') || []),
      walkingTime,
      true,
      false
    );

    // Create and show the overlay immediately
    console.log(`[MapView] Creating overlay for clicked station ${stationId}`, {
      stationName,
      walkingTime,
      hasMonitorData: !!existingMonitorData
    });
    
    this.clickedStationOverlay = new this.CustomMapOverlayCtor(position, content);
    if (this.clickedStationOverlay) {
      this.clickedStationOverlay.setMap(this.map);
    }

    // Fetch fresh data in the background
    this.isLoadingClickedStationData = true;
    if (stationData.diva) {
      this.apiService.getMonitorData([stationData.diva]).pipe(
        finalize(() => {
          this.isLoadingClickedStationData = false;
        })
      ).subscribe({
        next: (response) => {
          if (!response?.data?.monitors) return;

          // Find the monitor data for this station
          const monitorData = response.data.monitors.find(
            (monitor) => monitor?.locationStop && 'diva' in monitor.locationStop && monitor.locationStop.diva === stationData.diva
          );

          if (!monitorData) return;

          // Update the overlay with fresh data
          const patchedResponse = {
            ...response,
            data: response.data
              ? { ...response.data, monitors: (response.data.monitors as Monitor[]) }
              : null,
            message: response.message ?? ""
          };
          const updatedContent = this.generateOverlayContentHtml(
            stationName,
            stationId,
            stationData.diva ?? null,
            patchedResponse,
            new Set(monitorData.lines?.map((line) => 'line' in line ? String(line.line) : '') || []),
            walkingTime,
            true,
            false
          );

          if (this.clickedStationOverlay) {
            this.updateOverlayContent(this.clickedStationOverlay, updatedContent, position);
          }
        },
        error: (error) => {
          console.error('[MapView] Error fetching monitor data for clicked station:', error);
        }
      });
    } else {
      this.isLoadingClickedStationData = false;
    }
  }

  private findStationWithShortestWalkingTime(): number | null {
    let minWalkingTime = Number.POSITIVE_INFINITY;
    let stationWithShortestTime: number | null = null;
    
    this.activeDivaMapForPolling.forEach((_diva, stationId) => {
      const walkingTime = this.stationWalkingTimes.get(stationId);
      if (walkingTime !== undefined && walkingTime < minWalkingTime) {
        minWalkingTime = walkingTime;
        stationWithShortestTime = stationId;
      }
    });

    if (stationWithShortestTime !== null) {
      console.log(`[MapView] Found station with shortest walking time (${minWalkingTime} min): ${stationWithShortestTime}`);
    }
    return stationWithShortestTime;
  }

  private handleCloseOverlay(stationId: number): void {
    console.log('[MapView] Closing overlay for station:', stationId);
    
    if (this.isMobile) {
      this.activeMobileOverlayStationId = null;
      // On mobile, after closing an overlay, show the 3 closest stations
      if (this.stationWalkingTimes.size > 0) {
        const stationsToShow = this.selectStationsForOverlays(
          this.activeDivaMapForPolling,
          3
        );
        this.updateOverlaysForStations(
          this.activeDivaMapForPolling,
          this.lastMonitorResponse,
          stationsToShow
        );
      }
    } else {
      // On desktop, just remove the clicked station's overlay
      if (this.clickedStationOverlay) {
        this.clickedStationOverlay.destroy();
        this.clickedStationOverlay = null;
      }
      if (this.clickedStationHighlightMarker) {
        this.clickedStationHighlightMarker.setMap(null);
        this.clickedStationHighlightMarker = null;
      }
      this.clickedStationId = null;
      this.clickedStationDiva = null;
    }
  }

  private updateOverlayContent(overlay: any, content: string, position: google.maps.LatLng): void {
    overlay.setContent(content);
    overlay.setPosition(position);
    overlay.setMap(this.map); // Ensure overlay stays on map
    console.log('[MapView] Updated overlay content and position');
  }
}
