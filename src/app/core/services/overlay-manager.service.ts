import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MapManagerService } from './map-manager.service';

import { StationManagerService, Station, StationState } from './station-manager.service';
import { PollingService, PollingState } from './polling.service';
import { GoogleMapsService } from './google-maps.service';
import { createCustomMapOverlayClass, ICustomMapOverlay } from '../../features/map/components/map-view/custom-map-overlay';
import { MonitorApiResponse, Monitor, MonitorLine as RealTimeMonitorLine } from '@shared-types/api-models';
import { LineStopsResponse, MetroLine } from './api.service'; // Assuming ApiService defines these


export interface OverlayState {
  isInitialized: boolean;
  overlays: Map<number, ICustomMapOverlay>;
  highlightMarkers: Map<number, google.maps.Marker>;
  isMobile: boolean;
  isLoading: boolean;
  clickedStation: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class OverlayManagerService implements OnDestroy {
  private readonly MAX_OVERLAYS_DESKTOP = 3;
  private readonly MAX_OVERLAYS_MOBILE = 1;

  private state = new BehaviorSubject<OverlayState>({
    isInitialized: false,
    overlays: new Map(),
    highlightMarkers: new Map(),
    isMobile: false,
    isLoading: false,
    clickedStation: null
  });

  private readonly destroy$ = new Subject<void>();
  private CustomMapOverlayCtor: any;

  constructor(
    private mapManager: MapManagerService,
    private stationManager: StationManagerService,
    private pollingService: PollingService,
    private mapsService: GoogleMapsService
  ) {
    this.stationManager.state$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(state => {
      // Logic to update overlays based on station state
    });
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.mapsService.loadGoogleMapsApi().toPromise();
      this.initializeCustomMapOverlayCtor();
      this.setupSubscriptions();
      this.state.next({
        ...this.state.value,
        isInitialized: true
      });
    } catch (error) {
      console.error('Failed to initialize OverlayManagerService:', error);
    }
  }

  private initializeCustomMapOverlayCtor(): void {
    if (window.google?.maps) {
      this.CustomMapOverlayCtor = createCustomMapOverlayClass(window.google.maps);
    }
  }

  private setupSubscriptions(): void {
    // Subscribe to map state changes
    this.mapManager.state$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(mapState => {
      if (mapState.isInitialized) {
        this.updateOverlays();
      }
      this.setMobileMode(mapState.isMobile);
    });

    // Subscribe to station state changes
    this.stationManager.state$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(stationState => {
      this.state.next({
        ...this.state.value,
        clickedStation: stationState.clickedStation
      });
      this.updateOverlays();
    });

    // Subscribe to polling state changes
    this.pollingService.state$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(pollingState => {
      this.state.next({
        ...this.state.value,
        isLoading: pollingState.isLoading
      });
      this.updateOverlays();
    });
  }

  private updateOverlays(): void {
    const map = this.mapManager.mapInstance;
    if (!map || !this.CustomMapOverlayCtor) return;

    const stationState = this.stationManager.currentState;
    const pollingState = this.pollingService.currentState;
    const isDataStale = this.pollingService.isDataStale();

    const maxStations = this.state.value.isMobile ? this.MAX_OVERLAYS_MOBILE : this.MAX_OVERLAYS_DESKTOP;
    const stationsToShow = this.selectStationsForOverlays(
      stationState.stations,
      maxStations,
      stationState.clickedStation
    );

    console.log('OverlayManagerService: Stations to show:', Array.from(stationsToShow));
    console.log('OverlayManagerService: Overlays before removal:', this.state.value.overlays.size);

    // Remove overlays for stations that are no longer in the selected set
    this.state.value.overlays.forEach((overlay: ICustomMapOverlay, stationId: number) => {
      if (!stationsToShow.has(stationId)) {
        overlay.setMap(null);
        this.state.value.overlays.delete(stationId);
      }
    });
    console.log('OverlayManagerService: Overlays after removal:', this.state.value.overlays.size);

    // Create or update overlays for stations that should be shown
    stationsToShow.forEach(stationId => {
      const station = stationState.stations.get(stationId);
      if (!station || !station.position) return; // Ensure station and its position exist

      const monitorData = pollingState.lastResponse?.data?.monitors?.find(
        m => m.locationStop?.diva === station.diva
      );
      const isClickedStationNow = stationState.clickedStation === station.id;

      const content = this.generateOverlayContentHtml(
        station.name,
        station.id,
        station.diva,
        monitorData ? { data: { monitors: [monitorData] }, message: pollingState.lastResponse?.message, timestamp: pollingState.lastResponse?.timestamp } as MonitorApiResponse : null,
        new Set(monitorData?.lines?.map(line => 'line' in line ? String(line.line) : '') || []),
        station.walkingTime,
        isClickedStationNow,
        pollingState.isLoading,
        this.stationManager.lineStopsData
      );

      const existingOverlay = this.state.value.overlays.get(station.id);
      if (existingOverlay) {
        // Update existing overlay
        existingOverlay.setContent(content);
        existingOverlay.setPosition(station.position); // Directly pass google.maps.LatLng
        existingOverlay.setMap(map);
      } else {
        // Create new overlay
        const newOverlay = new this.CustomMapOverlayCtor(
          station.position, // Directly pass google.maps.LatLng
          content
        );
        newOverlay.setMap(map);
        this.state.value.overlays.set(station.id, newOverlay);
      }
    });

    this.state.next(this.state.value);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearAllOverlays();
  }

  get state$(): Observable<OverlayState> {
    return this.state.asObservable();
  }

  get currentState(): OverlayState {
    return this.state.value;
  }

  private setMobileMode(isMobile: boolean): void {
    this.state.next({
      ...this.state.value,
      isMobile
    });
  }

  clearAllOverlays(): void {
    const currentState = this.state.value;
    
    currentState.overlays.forEach(overlay => overlay.destroy());
    currentState.highlightMarkers.forEach(marker => marker.setMap(null));
    
    this.state.next({
      ...currentState,
      overlays: new Map(),
      highlightMarkers: new Map()
    });
  }

  clearOverlay(stationId: number): void {
    const currentState = this.state.value;
    
    const overlay = currentState.overlays.get(stationId);
    if (overlay) {
      overlay.destroy();
      currentState.overlays.delete(stationId);
    }

    const marker = currentState.highlightMarkers.get(stationId);
    if (marker) {
      marker.setMap(null);
      currentState.highlightMarkers.delete(stationId);
    }

    this.state.next(currentState);
  }

  private selectStationsForOverlays(
    allStations: Map<number, Station>,
    maxStations: number,
    clickedStationId: number | null = null
  ): Set<number> {
    // Original logic from MapViewComponent
    const stationsToShow = new Set<number>();

    // Always include clicked station if it exists
    if (clickedStationId !== null) {
      stationsToShow.add(clickedStationId);
    }

    // Get stations with walking times (filter out stations without walking time for sorting)
    const stationsWithWalkingTimes = Array.from(allStations.values())
      .filter(station => station.walkingTime !== undefined)
      .map(station => ({
        stationId: station.id,
        walkingTime: station.walkingTime!
      }))
      .filter(station => station.stationId !== clickedStationId) // Exclude clicked station from sorting
      .sort((a, b) => a.walkingTime - b.walkingTime);

    // If we have monitor data with lines, use line-based selection
    if (this.pollingService.currentState.lastResponse?.data?.monitors && this.stationManager.lineStopsData) {
      // Group stations by their lines
      const stationsByLine = new Map<string, { stationId: number; walkingTime: number }[]>();

      allStations.forEach((station, stationId) => {
        const walkingTime = station.walkingTime ?? Number.POSITIVE_INFINITY;
        if (walkingTime === Number.POSITIVE_INFINITY) return; // Skip if no walking time

        // Get lines for this station from monitor data
        const monitorData = this.pollingService.currentState.lastResponse?.data?.monitors?.find(
          monitor => monitor?.locationStop && 'diva' in monitor.locationStop && monitor.locationStop.diva === station.diva
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
      // If no monitor data or lineStopsData, use walking time based selection
      stationsWithWalkingTimes.slice(0, maxStations).forEach(station =>
        stationsToShow.add(station.stationId)
      );
    }

    // If on mobile and a specific station is meant to be active (e.g. from a click),
    // ensure only that one is shown.
    if (this.state.value.isMobile && clickedStationId !== null) {
      return new Set([clickedStationId]);
    }

    return stationsToShow;
  }

  private generateOverlayContentHtml(
    stationName: string,
    stationId: number,
    divaValue: string | number | null,
    monitorResponse: MonitorApiResponse | null,
    validLineBezeichnungen: Set<string>,
    walkingTimeInMinutes: number | undefined,
    isClickedStationNow: boolean,
    isGlobalPollingLoading: boolean,
    lineStopsData: LineStopsResponse | null
  ): string {
    let realTimeHtml = '';

    console.log("isGlobalPollingLoading",isGlobalPollingLoading);

    // Use the global polling loading state for the loading indicator
    const loadingLineClass = isGlobalPollingLoading ? 'loading-active' : '';

    if (isClickedStationNow && divaValue === null) {
      realTimeHtml = `<div class="status-message">Real-time data not available for this station.</div>`;
    } else if (isClickedStationNow && isGlobalPollingLoading) { // Use global loading here
      realTimeHtml = `<div class="loading-message">Loading departures...</div>`;
    } else if (monitorResponse && (monitorResponse as any).errorOccurred) {
      realTimeHtml = `<div class="status-message">Error loading real-time data.</div>`;
    } else if (monitorResponse && monitorResponse.data && monitorResponse.data.monitors) {
      const stationMonitor = monitorResponse.data.monitors.find(
        (monitor: Monitor) => {
          const monitorName = monitor.locationStop?.properties?.name;
          return monitorName === String(divaValue);
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
                if (lineStopsData && lineStopsData.lines) { // Use the passed lineStopsData
                  const linesArray = Object.values(lineStopsData.lines) as MetroLine[];
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
      <button class="overlay-close-button" data-station-id="${stationId}" style="cursor: pointer; border: none; background: none; padding: 0; pointer-events: auto; display: flex; align-items: center; justify-content: center;">
        <span class="material-icons" style="font-size: 16px; color: #555; padding: 4px; border-radius: 50%; background-color: rgba(255,255,255,0.8);">close</span>
      </button>` : '';

    return `
      <div class="custom-map-overlay ${isClickedStationNow ? 'clicked-station-overlay' : ''}" style="position: relative; background: white; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); padding: 6px 8px 6px;">
        <div class="station-info-header" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <span class="station-name-bold">${stationName}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${walkingTimeDisplayHtml}
            ${closeButtonHtml}
          </div>
        </div>
        <div class="loading-line-indicator ${loadingLineClass}"></div>
        <div class="real-time-data">
          ${realTimeHtml}
        </div>
      </div>`;
  }
} 