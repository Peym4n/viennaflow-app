import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { map, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { MapManagerService, MapState } from './map-manager.service';
import { ApiService, LineStopsResponse, MetroLine, GeoJsonFeature } from './api.service';
import { MonitorApiResponse } from '@shared-types/api-models';

export interface Station {
  id: number;
  name: string;
  position: google.maps.LatLng;
  diva: string | number;
  lines: string[];
  walkingTime?: number;
}

export interface StationState {
  stations: Map<number, Station>;
  nearbyStations: Set<number>;
  clickedStation: number | null;
  isMobile: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class StationManagerService implements OnDestroy {
  private readonly MAX_OVERLAYS_DESKTOP = 3;
  private readonly MAX_OVERLAYS_MOBILE = 1;

  private state = new BehaviorSubject<StationState>({
    stations: new Map(),
    nearbyStations: new Set(),
    clickedStation: null,
    isMobile: false
  });

  public lineStopsData: LineStopsResponse | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private mapManager: MapManagerService,
    private apiService: ApiService
  ) {
    // Subscribe to map manager's mobile state changes
    this.mapManager.state$.pipe(
      map((state: MapState) => state.isMobile),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe((isMobile: boolean) => {
      this.setMobileMode(isMobile);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get state$(): Observable<StationState> {
    return this.state.asObservable();
  }

  get currentState(): StationState {
    return this.state.value;
  }

  setMobileMode(isMobile: boolean): void {
    const currentState = this.state.value;
    this.state.next({
      ...currentState,
      isMobile
    });
  }

  async loadStations(): Promise<void> {
    try {
      const response = await this.apiService.getMetroLineStops().toPromise();
      if (response) {
        this.lineStopsData = response;
        this.processLineStopsResponse(response);
      }
    } catch (error) {
      console.error('Failed to load stations:', error);
      throw error;
    }
  }

  private processLineStopsResponse(response: LineStopsResponse): void {
    const stations = new Map<number, Station>();

    Object.values(response.lines).forEach((line: MetroLine) => {
      line.stops.features.forEach((feature: GeoJsonFeature) => {
        const stop = feature.properties;
        if (!stations.has(stop.haltestellen_id)) {
          stations.set(stop.haltestellen_id, {
            id: stop.haltestellen_id,
            name: stop.name,
            position: new google.maps.LatLng(
              feature.geometry.coordinates[1],
              feature.geometry.coordinates[0]
            ),
            diva: stop.diva,
            lines: stop.linien_ids,
            walkingTime: undefined
          });
        } else {
          const station = stations.get(stop.haltestellen_id)!;
          stop.linien_ids.forEach(lineId => {
            if (!station.lines.includes(lineId)) {
              station.lines.push(lineId);
            }
          });
        }
      });
    });

    this.mapManager.drawMetroLines(Object.values(response.lines));
    this.mapManager.drawStationMarkers(
      Array.from(stations.values()),
      this.currentState.nearbyStations
    );

    this.state.next({
      ...this.state.value,
      stations
    });
  }

  updateNearbyStations(nearbyStationIds: number[]): void {
    const currentState = this.state.value;
    this.state.next({
      ...currentState,
      nearbyStations: new Set(nearbyStationIds)
    });
  }

  updateWalkingTimes(walkingTimes: Map<number, number>): void {
    const currentState = this.state.value;
    const updatedStations = new Map(currentState.stations);

    walkingTimes.forEach((time, stationId) => {
      const station = updatedStations.get(stationId);
      if (station) {
        updatedStations.set(stationId, {
          ...station,
          walkingTime: time
        });
      }
    });

    this.state.next({
      ...currentState,
      stations: updatedStations
    });
  }

  handleStationClick(stationId: number): void {
    const currentState = this.state.value;
    const station = currentState.stations.get(stationId);

    if (!station) return;

    this.state.next({
      ...currentState,
      clickedStation: stationId
    });
  }

  closeOverlay(stationId: number): void {
    const currentState = this.state.value;
    this.state.next({
      ...currentState,
      clickedStation: currentState.clickedStation === stationId ? null : currentState.clickedStation
    });
  }

  async loadInitialData(): Promise<void> {
    await this.loadStations();
  }
} 