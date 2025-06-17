import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, timer, of, Subscription } from 'rxjs';
import { takeUntil, switchMap, catchError, tap, map } from 'rxjs/operators';
import { ApiService, MonitorApiResponse } from './api.service';
import { StationManagerService } from './station-manager.service';
import { MapManagerService } from './map-manager.service';

export interface PollingState {
  isActive: boolean;
  isBackground: boolean;
  lastResponse: MonitorApiResponse | null;
  lastETag: string | null;
  pollingInterval: number;
  error: string | null;
  isDataStale: boolean;
  isLoading: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PollingService implements OnDestroy {
  private readonly DEFAULT_ACTIVE_INTERVAL = 10000; // 10 seconds
  private readonly DEFAULT_BACKGROUND_INTERVAL = 60000; // 60 seconds
  private readonly CACHE_VALIDITY_MS = 30000; // 30 seconds

  private state = new BehaviorSubject<PollingState>({
    isActive: true,
    isBackground: false,
    lastResponse: null,
    lastETag: null,
    pollingInterval: this.DEFAULT_ACTIVE_INTERVAL,
    error: null,
    isDataStale: false,
    isLoading: false
  });

  private readonly destroy$ = new Subject<void>();
  private pollingSubscription: Subscription | null = null;
  private monitoredDivas = new Map<number, string | number>();

  constructor(
    private apiService: ApiService,
    private stationManager: StationManagerService,
    private mapManager: MapManagerService
  ) {
    this.stationManager.state$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(state => {
      const divasToPoll = new Map<number, string | number>();
      state.nearbyStations.forEach(stationId => {
        const station = state.stations.get(stationId);
        if (station && station.diva) {
          divasToPoll.set(stationId, station.diva);
        }
      });
      if (state.clickedStation) {
        const station = state.stations.get(state.clickedStation);
        if (station && station.diva) {
          divasToPoll.set(state.clickedStation, station.diva);
        }
      }
      this.updateMonitoredStations(divasToPoll);
    });

    // Subscribe to visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private updateMonitoredStations(divasToPoll: Map<number, string | number>): void {
    const newDivaIds = Array.from(divasToPoll.values());
    const currentDivaIds = Array.from(this.monitoredDivas.values());

    if (JSON.stringify(newDivaIds.sort()) === JSON.stringify(currentDivaIds.sort())) {
      return; // No change in monitored stations
    }

    this.monitoredDivas = divasToPoll;

    if (this.monitoredDivas.size > 0) {
      this.startPolling(Array.from(this.monitoredDivas.values()));
    } else {
      this.stopPolling();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.destroy$.next();
    this.destroy$.complete();
    this.stopPolling();
  }

  get state$(): Observable<PollingState> {
    return this.state.asObservable();
  }

  get currentState(): PollingState {
    return this.state.value;
  }

  private handleVisibilityChange = (): void => {
    const isBackground = document.visibilityState !== 'visible';
    this.state.next({
      ...this.state.value,
      isBackground,
      pollingInterval: isBackground ? this.DEFAULT_BACKGROUND_INTERVAL : this.DEFAULT_ACTIVE_INTERVAL
    });
    this.updatePolling();
  };

  startPolling(divaIds: (string | number)[]): void {
    if (this.pollingSubscription) {
      this.stopPolling();
    }

    const currentState = this.state.value;
    this.state.next({
      ...currentState,
      isActive: true,
      error: null
    });

    this.pollingSubscription = timer(0, currentState.pollingInterval).pipe(
      takeUntil(this.destroy$),
      switchMap(() => {
        const headers: Record<string, string> = {};
        if (currentState.lastETag) {
          headers['If-None-Match'] = currentState.lastETag;
        }

        return this.apiService.getRealTimeDepartures(divaIds, headers).pipe(
          tap(response => {
            if (response.headers?.etag) {
              this.state.next({
                ...this.state.value,
                lastETag: response.headers.etag
              });
            }

            // Check if data is stale
            const isStale = response.timestamp && 
              (Date.now() - response.timestamp) > this.CACHE_VALIDITY_MS;

            this.state.next({
              ...this.state.value,
              lastResponse: response,
              error: isStale ? 'Data is stale' : null
            });
          }),
          catchError(error => {
            console.error('Polling error:', error);
            this.state.next({
              ...this.state.value,
              error: 'Failed to fetch real-time data'
            });
            return of(null);
          })
        );
      })
    ).subscribe();
  }

  stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
    this.state.next({
      ...this.state.value,
      isActive: false
    });
  }

  private updatePolling(): void {
    const currentState = this.state.value;
    if (currentState.isActive) {
      // Restart polling with new interval
      this.stopPolling();
      this.startPolling(Array.from(this.monitoredDivas.values()));
    }
  }

  isDataStale(): boolean {
    const currentState = this.state.value;
    if (!currentState.lastResponse?.timestamp) return true;
    
    return (Date.now() - currentState.lastResponse.timestamp) > this.CACHE_VALIDITY_MS;
  }
} 