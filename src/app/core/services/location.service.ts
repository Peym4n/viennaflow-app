import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, ReplaySubject, distinctUntilChanged, filter, map } from 'rxjs';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}
export interface LocationState {
  status: 'locating' | 'current' | 'stale' | 'denied' | 'unavailable' | 'unsupported';
  coordinates?: Coordinates;
}

@Injectable({ providedIn: 'root' })
export class LocationService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<LocationState>({ status: 'locating' });
  readonly state$ = this.stateSubject.asObservable();
  private readonly coordinatesSubject = new ReplaySubject<Coordinates>(1);
  readonly currentLocation$ = this.coordinatesSubject.asObservable();
  readonly locationAvailable$ = this.state$.pipe(
    filter(state => state.status !== 'locating'),
    map(state => state.status === 'current'), distinctUntilChanged(),
  );
  private watchId: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private permission: PermissionStatus | undefined;
  private destroyed = false;
  private generation = 0;
  private lastCoordinates: Coordinates | null = null;
  private readonly permissionChanged = () => {
    if (this.permission?.state === 'granted') this.retryLocationAccess();
  };

  constructor() {
    this.startWatch();
    void navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
      if (this.destroyed) return;
      this.permission = permission;
      permission.addEventListener('change', this.permissionChanged);
    }).catch(() => {});
  }

  retryLocationAccess(): void {
    if (this.destroyed) return;
    clearTimeout(this.retryTimer);
    this.startWatch();
  }

  getLastKnownCoordinates(): Coordinates | null { return this.lastCoordinates; }

  private startWatch(): void {
    this.clearWatch();
    if (!navigator.geolocation) {
      this.stateSubject.next({ status: 'unsupported' });
      return;
    }
    const generation = ++this.generation;
    this.watchId = navigator.geolocation.watchPosition(position => {
      if (this.destroyed || generation !== this.generation) return;
      const coordinates: Coordinates = {
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp,
      };
      this.lastCoordinates = coordinates;
      clearTimeout(this.retryTimer);
      this.stateSubject.next({ status: 'current', coordinates });
      this.coordinatesSubject.next(coordinates);
    }, error => {
      if (this.destroyed || generation !== this.generation) return;
      this.stateSubject.next({
        status: error.code === 1 ? 'denied' : this.lastCoordinates ? 'stale' : 'unavailable',
        coordinates: this.lastCoordinates ?? undefined,
      });
      clearTimeout(this.retryTimer);
      if (error.code !== 1) this.retryTimer = setTimeout(() => this.startWatch(), 5000);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }

  private clearWatch(): void {
    if (this.watchId !== null) navigator.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.clearWatch();
    clearTimeout(this.retryTimer);
    this.permission?.removeEventListener('change', this.permissionChanged);
    this.stateSubject.complete();
    this.coordinatesSubject.complete();
  }
}
