import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, timer } from 'rxjs';
import { takeUntil, filter, take } from 'rxjs/operators';
import { LocationService, Coordinates } from './location.service';
import { MapManagerService } from './map-manager.service';
import { ApiService } from './api.service';
import { StationManagerService } from './station-manager.service';
import { GoogleMapsService } from './google-maps.service';

export interface LocationState {
  currentLocation: google.maps.LatLng | null;
  walkingTimes: Map<number, number>;
  error: string | null;
  isInitialized: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LocationManagerService implements OnDestroy {
  private readonly WALKING_TIME_UPDATE_INTERVAL = 60000; // 1 minute
  private readonly MIN_MOVEMENT_DISTANCE = 50; // meters
  private readonly WALKING_SPEED_THRESHOLD = 2.5; // m/s

  private state = new BehaviorSubject<LocationState>({
    currentLocation: null,
    walkingTimes: new Map(),
    error: null,
    isInitialized: false
  });

  private readonly destroy$ = new Subject<void>();
  private walkingTimeUpdateTimer: any;

  constructor(
    private locationService: LocationService,
    private mapManager: MapManagerService,
    private apiService: ApiService,
    private mapsService: GoogleMapsService,
    private stationManager: StationManagerService
  ) {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.mapsService.loadGoogleMapsApi().toPromise();
      this.state.next({
        ...this.state.value,
        isInitialized: true
      });
    } catch (error) {
      console.error('Failed to initialize LocationManagerService:', error);
      this.state.next({
        ...this.state.value,
        error: 'Failed to initialize location services'
      });
    }
  }

  public setupLocationUpdates(): void {
    if (!this.state.value.isInitialized) {
      console.warn('LocationManagerService not initialized yet');
      return;
    }

    // Wait for stations to be loaded before setting up location updates
    this.stationManager.state$.pipe(
      filter(stationState => stationState.stations.size > 0),
      take(1),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      console.log('LocationManagerService: Stations loaded, setting up location updates.');
      this.locationService.currentLocation$.pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (location) => {
          if (location) {
            this.handleLocationUpdate(location);
          }
        },
        error: (error) => {
          console.error('Location error:', error);
          this.state.next({
            ...this.state.value,
            error: 'Failed to get location. Please check your location settings.'
          });
        }
      });
    });
  }

  private handleLocationUpdate(coordinates: Coordinates): void {
    if (!this.state.value.isInitialized) return;

    const newLocation = new google.maps.LatLng(coordinates.latitude, coordinates.longitude);
    const currentState = this.state.value;

    this.mapManager.updateUserLocation(coordinates);
    const metrics = this.mapManager.calculateMovementMetrics(newLocation);

    this.state.next({
      ...currentState,
      currentLocation: newLocation,
      error: null
    });

    if (metrics.shouldUpdateNearbyStations) {
      this.fetchNearbyStations(newLocation);
    } else if (metrics.speed < this.WALKING_SPEED_THRESHOLD) {
      // If not fetching new stations, still update walking times for existing nearby stations
      this.updateWalkingTimes(newLocation, Array.from(this.stationManager.currentState.nearbyStations));
    }
  }

  private async fetchNearbyStations(location: google.maps.LatLng): Promise<void> {
    try {
      const nearbySteige = await this.apiService.getNearbySteige(location.lat(), location.lng()).toPromise();
      if (nearbySteige) {
        const nearbyStationIds = [...new Set(nearbySteige.map(steig => steig.fk_haltestellen_id))];
        this.stationManager.updateNearbyStations(nearbyStationIds);
        this.updateWalkingTimes(location, nearbyStationIds);
      } else {
        this.stationManager.updateNearbyStations([]);
      }
    } catch (error) {
      console.error('Failed to fetch nearby stations:', error);
      this.stationManager.updateNearbyStations([]);
    }
  }

  private updateWalkingTimes(location: google.maps.LatLng, nearbyStationIds: number[]): void {
    const allStations = this.stationManager.currentState.stations;

    if (!nearbyStationIds.length) {
      console.log('LocationManagerService: updateWalkingTimes - No nearby stations to calculate walking times for.');
      this.stationManager.updateWalkingTimes(new Map());
      return;
    }

    const destinations = nearbyStationIds
      .map(id => allStations.get(id))
      .filter(station => !!station)
      .map(station => ({ lat: station!.position.lat(), lng: station!.position.lng() }));

    if (!destinations.length) {
      console.warn('LocationManagerService: No valid destinations found for walking time calculation.');
      return;
    }

    this.mapsService.getWalkingDurationsToStations(
      { lat: location.lat(), lng: location.lng() },
      destinations
    ).subscribe(response => {
      if (response) {
        const walkingTimes = new Map<number, number>();
        response.rows[0].elements.forEach((element, index) => {
          const stationId = nearbyStationIds[index];
          if (element.status === 'OK') {
            const durationInMinutes = Math.ceil(element.duration.value / 60);
            walkingTimes.set(stationId, durationInMinutes);
          }
        });

        this.stationManager.updateWalkingTimes(walkingTimes);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.walkingTimeUpdateTimer) {
      clearInterval(this.walkingTimeUpdateTimer);
    }
  }

  get state$(): Observable<LocationState> {
    return this.state.asObservable();
  }

  get currentState(): LocationState {
    return this.state.value;
  }
} 