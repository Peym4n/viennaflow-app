import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, ViewChild, afterNextRender, computed, inject, signal } from '@angular/core';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ReplaySubject, Subject, catchError, concat, distinctUntilChanged, filter, finalize, forkJoin, map, of, switchMap, take, takeUntil, tap, timer } from 'rxjs';
import { LatLng } from '@shared-types/api-models';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService } from '../../../../core/services/api.service';
import { LocationService } from '../../../../core/services/location.service';
import { StationDepartureState } from '../../station-departures';
import { WalkingTimes } from '../../walking-times';
import { GoogleMapFacade } from '../../google-map-facade';
import { MapStation, catalogStations, closestStations, stationCard } from '../../map-presentation';

@Component({
  selector: 'app-map-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LocationService, GoogleMapFacade],
  imports: [MatAutocomplete, MatAutocompleteTrigger, MatOption, MatProgressSpinnerModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './map-view.component.html',
  styleUrl: './map-view.component.css',
})
export class MapViewComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly isLoading = signal(true);
  readonly mapError = signal(false);
  readonly showLocationWarning = signal(false);
  readonly offline = signal(typeof navigator !== 'undefined' && !navigator.onLine);
  readonly showMetroLines = signal(true);
  readonly showStations = signal(false);
  readonly showStationPicker = signal(false);
  readonly stationOptions = signal<MapStation[]>([]);
  readonly stationQuery = signal('');
  readonly filteredStations = computed(() => {
    const query = stationSearchText(this.stationQuery());
    return this.stationOptions().filter(station => stationSearchText(station.name).includes(query));
  });
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLElement>;
  @ViewChild('stationChoiceButton', { read: ElementRef }) private stationChoiceButton?: ElementRef<HTMLElement>;
  @ViewChild('stationPicker') set stationPicker(element: ElementRef<HTMLInputElement> | undefined) {
    element?.nativeElement.focus();
  }
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly mapsService = inject(GoogleMapsService);
  private readonly api = inject(ApiService);
  private readonly location = inject(LocationService);
  private readonly rendering = inject(GoogleMapFacade);
  private readonly destroyed$ = new Subject<void>();
  private readonly viewReady$ = new ReplaySubject<void>(1);
  private readonly departures = new StationDepartureState(divas => this.api.getRealTimeDepartures(divas));
  private readonly walking = new WalkingTimes(
    payload => this.api.getSecureWalkingMatrix(payload), (a, b) => this.rendering.distance(a, b),
    times => { this.walkingTimes = times; this.render(); },
  );
  private stations = new Map<number, MapStation>();
  private colors = new Map<string, string>();
  private nearby = new Map<number, string | number>();
  private selectedId: number | null = null;
  private walkingTimes = new Map<number, number>();
  private position: LatLng | null = null;
  private successfulNearbyOrigin: LatLng | null = null;
  private pendingNearbyOrigin: LatLng | null = null;
  private speedOrigin: { position: LatLng; timestamp: number } | null = null;
  private walkingAllowed = true;
  private ready = false;
  private mobile = false;
  private media?: MediaQueryList;
  private selectionOrigin: HTMLElement | null = null;
  private readonly onResize = () => { this.mobile = this.media!.matches; this.render(); };
  private readonly onVisibility = () => this.departures.setActive(document.visibilityState === 'visible');
  private readonly onNetwork = () => { this.offline.set(!navigator.onLine); this.render(); };

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onNetwork);
    window.addEventListener('offline', this.onNetwork);
    this.onVisibility();
    this.departures.changes$.pipe(takeUntil(this.destroyed$)).subscribe(() => this.render());
    this.media = window.matchMedia('(max-width: 599px)');
    this.mobile = this.media.matches;
    this.media.addEventListener('change', this.onResize);
    forkJoin({ sdk: this.mapsService.loadGoogleMapsApi().pipe(take(1)),
      catalog: this.api.getMetroLineStops().pipe(take(1)), view: this.viewReady$.pipe(take(1)),
    }).pipe(takeUntil(this.destroyed$)).subscribe({
      next: ({ catalog }) => {
        this.stations = catalogStations(catalog);
        this.colors = new Map(Object.values(catalog.lines).map(line => [line.bezeichnung, line.farbe]));
        this.stationOptions.set([...this.stations.values()].sort((a, b) => a.name.localeCompare(b.name)));
        this.rendering.initialize(this.mapContainer.nativeElement, catalog, this.stations, {
          selectStation: id => this.selectStation(id), closeStation: id => this.closeStation(id),
          copyCoordinates: position => this.copyCoordinates(position),
        });
        this.ready = true;
        this.isLoading.set(false);
        this.render();
        this.trackLocation();
      },
      error: () => { this.mapError.set(true); this.isLoading.set(false); },
    });
  }

  ngAfterViewInit(): void { this.viewReady$.next(); this.viewReady$.complete(); }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.media?.removeEventListener('change', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onNetwork);
    window.removeEventListener('offline', this.onNetwork);
    this.departures.destroy();
    this.walking.destroy();
    this.rendering.destroy();
    this.ready = false;
  }

  retryLocation(): void { this.location.retryLocationAccess(); }
  recenterMap(): void { this.rendering.recenter(); }
  toggleMetroLines(): void { this.showMetroLines.update(value => !value); this.render(); }
  toggleStations(): void { this.showStations.update(value => !value); this.render(); }
  toggleStationPicker(): void {
    this.stationQuery.set('');
    this.showStationPicker.update(value => !value);
  }

  searchStations(event: Event): void { this.stationQuery.set((event.target as HTMLInputElement).value); }

  chooseStation(id: number): void {
    if (!this.stations.has(id)) return;
    this.selectionOrigin = this.stationChoiceButton?.nativeElement ?? null;
    this.showStationPicker.set(false);
    this.selectStation(id, true);
    this.rendering.showStation(id);
    afterNextRender(() => this.rendering.focusCard(id), { injector: this.injector });
  }

  private selectStation(id: number, fromPicker = false): void {
    const station = this.stations.get(id);
    if (!station || !this.ready) return;
    if (!fromPicker && document.activeElement instanceof HTMLElement && !document.activeElement.closest('app-station-card')) {
      this.selectionOrigin = document.activeElement;
    }
    this.selectedId = id === this.nearby.keys().next().value ? null : id;
    if (this.selectedId === null) this.departures.clearSelection();
    else this.departures.select(id, station.diva);
    this.render();
    if (!fromPicker) this.rendering.focusCard(id);
  }

  private closeStation(id: number): void {
    if (id !== this.selectedId) return;
    this.selectedId = null;
    this.departures.clearSelection();
    this.render();
    const origin = this.selectionOrigin?.isConnected ? this.selectionOrigin : this.stationChoiceButton?.nativeElement;
    origin?.focus({ preventScroll: true });
  }

  private render(): void {
    if (!this.ready) return;
    const makeCard = (station: MapStation) => {
      const state = this.departures.get(station.diva);
      return stationCard(station, this.offline() && state.monitor ? { ...state, status: 'stale' } : state,
        this.colors, station.id === this.selectedId, this.walkingTimes.get(station.id));
    };
    const visibleId = this.selectedId ?? this.nearby.keys().next().value;
    const visible = visibleId === undefined ? undefined : this.stations.get(visibleId);
    const cards = visible ? [makeCard(visible)] : [];
    this.rendering.render({ cards, nearbyIds: new Set(this.nearby.keys()), selectedId: this.selectedId,
      mobile: this.mobile, showStations: this.showStations(), showLines: this.showMetroLines() });
  }

  private trackLocation(): void {
    this.location.locationAvailable$.pipe(
      distinctUntilChanged(),
      switchMap(available => available ? of(false) : concat(of(true), timer(10000).pipe(map(() => false)))),
      takeUntil(this.destroyed$),
    ).subscribe(visible => this.showLocationWarning.set(visible));
    this.location.currentLocation$.pipe(
      map(coordinates => {
        const position = { lat: coordinates.latitude, lng: coordinates.longitude };
        const previous = this.speedOrigin;
        const timestamp = coordinates.timestamp ?? Date.now();
        const elapsed = previous ? (timestamp - previous.timestamp) / 1000 : 0;
        const allowed = !previous || elapsed <= 0 || this.rendering.distance(previous.position, position) / elapsed <= 2.5;
        const resumed = !this.walkingAllowed && allowed;
        this.walkingAllowed = allowed;
        if (!allowed) this.walking.cancel();
        this.position = position;
        this.speedOrigin = { position, timestamp };
        this.rendering.updatePosition(position);
        const needsNearby = !this.successfulNearbyOrigin || resumed || this.rendering.distance(position, this.successfulNearbyOrigin) > 50;
        if (!needsNearby) this.requestWalking();
        return { position, needsNearby };
      }),
      filter(({ position, needsNearby }) => needsNearby && (!this.pendingNearbyOrigin ||
        this.pendingNearbyOrigin.lat !== position.lat || this.pendingNearbyOrigin.lng !== position.lng)),
      switchMap(({ position }) => {
        this.pendingNearbyOrigin = position;
        return this.api.getNearbySteige(position.lat, position.lng, 800).pipe(
          tap(platforms => {
            this.successfulNearbyOrigin = position;
            const ids = new Set(platforms.map(platform => platform.fk_haltestellen_id));
            const candidates = [...this.stations.values()].filter(station => ids.has(station.id));
            this.nearby = new Map(closestStations(candidates, target => this.rendering.distance(position, target))
              .map(station => [station.id, station.diva]));
            this.departures.setNearby(this.nearby);
            this.requestWalking();
            this.render();
          }),
          catchError(() => {
            this.snackBar.open('Nearby stations could not be updated. Retrying on the next location update.', 'Close', { duration: 4000 });
            return of(null);
          }),
          finalize(() => { if (this.pendingNearbyOrigin === position) this.pendingNearbyOrigin = null; }),
        );
      }), takeUntil(this.destroyed$),
    ).subscribe();
  }

  private requestWalking(): void {
    if (!this.position) return;
    const targets = [...this.nearby.keys()].flatMap(id => {
      const station = this.stations.get(id);
      return station ? [{ stationId: id, latLng: station.routingPosition }] : [];
    });
    this.walking.request(this.position, targets, this.walkingAllowed);
  }

  private copyCoordinates(position: LatLng): void {
    const text = `${position.lng.toFixed(7)}, ${position.lat.toFixed(7)}`;
    if (!navigator.clipboard) { this.snackBar.open('Copying coordinates is unavailable.', 'Close'); return; }
    navigator.clipboard.writeText(text).then(() => this.snackBar.open(`Coordinates copied: ${text}`, 'Close', { duration: 2000 }))
      .catch(() => this.snackBar.open('Failed to copy coordinates.', 'Close', { duration: 3000 }));
  }
}

function stationSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-AT').replaceAll('ß', 'ss').trim();
}
