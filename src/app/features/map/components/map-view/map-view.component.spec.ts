import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReplaySubject, Subject, of, throwError } from 'rxjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorApiResponse } from '@shared-types/api-models';
import { MapViewComponent } from './map-view.component';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService, LineStopsResponse } from '../../../../core/services/api.service';
import { Coordinates, LocationService } from '../../../../core/services/location.service';
import { GoogleMapFacade } from '../../google-map-facade';
import { installGoogleMaps } from '../../../../../../testing/google-maps';
import { normalizeMonitorResponse } from '../../../../core/services/monitor-response';
import fixtureData from '../../../../../../api/monitor-u6-sample.json';

const monitorSample = normalizeMonitorResponse(fixtureData);

const catalog: LineStopsResponse = {
  metainfo: { version: 'test', last_updated: '2025-05-21' },
  lines: { '306': {
    bezeichnung: 'U6', farbe: '#9d6930', reihenfolge: 6, echtzeit: true,
    lineStrings: [{ type: 'LineString', coordinates: [[16.3, 48.2], [16.31, 48.21]] }],
    stops: { type: 'FeatureCollection', features: [
      { id: 1, diva: 60201394, name: 'Tscherttegasse', lat: 48.2 },
      { id: 2, diva: 60200002, name: 'Second station', lat: 48.201 },
      { id: 3, diva: 60200003, name: 'Third station', lat: 48.202 },
      { id: 4, diva: 60200004, name: 'Fourth station', lat: 48.23 },
    ].map(stop => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [16.3, stop.lat] },
      properties: { haltestellen_id: stop.id, diva: stop.diva, name: stop.name, linien_ids: [306] } })) },
  } },
};
const nearbyPlatforms = [...catalog.lines['306'].stops.features, catalog.lines['306'].stops.features[0]]
  .map(station => ({ fk_haltestellen_id: station.properties.haltestellen_id, haltestellen_diva: station.properties.diva }));

describe('Map station selection, rendering and lifecycle', () => {
  let sdk: ReturnType<typeof installGoogleMaps>;
  let fixture: ComponentFixture<MapViewComponent>;
  let response: Subject<MonitorApiResponse>;
  let coordinates: ReplaySubject<Coordinates>;
  let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  let api: { getMetroLineStops: ReturnType<typeof vi.fn>; getRealTimeDepartures: ReturnType<typeof vi.fn>; getNearbySteige: ReturnType<typeof vi.fn>; getSecureWalkingMatrix: ReturnType<typeof vi.fn> };
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('app-station-card'));
  const selectedCard = () => document.querySelector<HTMLElement>('app-station-card:has(.selected)')!;
  const highlightedStations = () => sdk.markers.filter(marker => marker.options.visible === true && marker.map !== null).map(marker => marker.getTitle());

  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterAll(() => TestBed.resetTestEnvironment());
  beforeEach(() => {
    vi.useFakeTimers();
    sdk = installGoogleMaps();
    response = new Subject<MonitorApiResponse>();
    coordinates = new ReplaySubject<Coordinates>(1);
    media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    api = {
      getMetroLineStops: vi.fn(() => of(catalog)), getRealTimeDepartures: vi.fn(() => response),
      getNearbySteige: vi.fn(() => of(nearbyPlatforms)), getSecureWalkingMatrix: vi.fn(() => of({ rows: [{ elements: [] }] })),
    };
    TestBed.configureTestingModule({
      imports: [MapViewComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations(),
        { provide: GoogleMapsService, useValue: { loadGoogleMapsApi: () => of(undefined) } },
        { provide: ApiService, useValue: api }, { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).overrideComponent(MapViewComponent, { set: {
      providers: [GoogleMapFacade, { provide: LocationService, useValue: {
        currentLocation$: coordinates, locationAvailable$: new Subject(), retryLocationAccess: vi.fn(),
      } }],
    } });
    fixture = TestBed.createComponent(MapViewComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    sdk.dispose();
    vi.useRealTimers();
  });

  function select(title: string) {
    sdk.markers.find(marker => marker.getTitle() === title)!.trigger('click');
    vi.advanceTimersByTime(0);
    fixture.detectChanges();
  }
  function resize(mobile: boolean) {
    media.matches = mobile;
    media.addEventListener.mock.calls.find(call => call[0] === 'change')![1]();
    fixture.detectChanges();
  }

  it('preserves hidden station defaults and explicitly enables one-finger map gestures', () => {
    expect(fixture.componentInstance.showStations()).toBe(false);
    expect(sdk.maps[0].options.gestureHandling).toBe('greedy');
  });

  it('renders cached departures using the fixture DIVA in locationStop.properties.name', () => {
    select('Tscherttegasse');
    response.next({ ...monitorSample, timestamp: Date.now() });
    select('Tscherttegasse');
    expect(selectedCard().textContent).toContain('Floridsdorf');
    expect(selectedCard().textContent).not.toContain('format error');
  });

  it('keeps an uncached selection loading while another station has cached data', () => {
    select('Tscherttegasse');
    response.next({ ...monitorSample, timestamp: Date.now() });
    select('Second station');
    expect(selectedCard().textContent).toContain('Loading');
    expect(selectedCard().textContent).not.toContain('format error');
    response.next({ data: { monitors: [] }, message: 'Empty', timestamp: Date.now() });
    expect(selectedCard().textContent).not.toContain('Loading');
  });

  it('replaces selected-station polling membership and stops on close and teardown', () => {
    select('Tscherttegasse'); select('Second station'); select('Third station');
    expect(api.getRealTimeDepartures.mock.calls.at(-1)![0]).toEqual(['60200003']);
    selectedCard().querySelector<HTMLButtonElement>('.overlay-close-button')!.click();
    const count = api.getRealTimeDepartures.mock.calls.length;
    vi.advanceTimersByTime(60000);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(count);
    expect(cards()).toHaveLength(0);
  });

  it('replays a location received before the catalog and starts without map idle', () => {
    fixture.destroy();
    const delayedCatalog = new Subject<LineStopsResponse>();
    api.getMetroLineStops.mockReturnValue(delayedCatalog);
    fixture = TestBed.createComponent(MapViewComponent);
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    fixture.detectChanges();
    expect(api.getSecureWalkingMatrix).not.toHaveBeenCalled();
    delayedCatalog.next(catalog);
    expect(api.getNearbySteige).toHaveBeenCalledWith(48.2, 16.3, 800);
    expect(api.getSecureWalkingMatrix).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(1);
    expect(sdk.markers.some(marker => marker.getTitle() === 'Your location')).toBe(true);
  });

  it('updates the closest set after movement and cancels superseded departure requests', () => {
    const first = new Subject<MonitorApiResponse>(); const second = new Subject<MonitorApiResponse>();
    api.getRealTimeDepartures.mockReturnValueOnce(first).mockReturnValue(second);
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    coordinates.next({ latitude: 48.2001, longitude: 16.3, timestamp: 11000 });
    vi.advanceTimersByTime(0);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(1);
    expect(api.getNearbySteige).toHaveBeenCalledTimes(1);
    coordinates.next({ latitude: 48.23, longitude: 16.3, timestamp: 2000000 });
    vi.advanceTimersByTime(0);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(2);
    expect(api.getNearbySteige).toHaveBeenCalledTimes(2);
    expect(api.getRealTimeDepartures.mock.calls.at(-1)![0]).toEqual(['60200002', '60200003', '60200004']);
    expect(highlightedStations()).toEqual(expect.arrayContaining(['Second station', 'Third station', 'Fourth station']));
    expect(highlightedStations()).toHaveLength(3);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Fourth station');
    expect(first.observed).toBe(false);
    fixture.destroy();
    expect(second.observed).toBe(false);
  });

  it('cancels old nearby requests and makes only one request for a large jump', () => {
    const first = new Subject(); const second = new Subject();
    api.getNearbySteige.mockReturnValueOnce(first).mockReturnValue(second);
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    coordinates.next({ latitude: 48.22, longitude: 16.3, timestamp: 2000 });
    expect(api.getNearbySteige).toHaveBeenCalledTimes(2);
    expect(first.observed).toBe(false);
    fixture.destroy();
    expect(second.observed).toBe(false);
  });

  it('retries failed nearby loading at the same coordinates', () => {
    api.getNearbySteige.mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValue(of([]));
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 2000 });
    expect(api.getNearbySteige).toHaveBeenCalledTimes(2);
  });

  it('preloads only the closest three eligible stations and shows only the closest card on desktop and mobile', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    expect(api.getRealTimeDepartures).toHaveBeenCalledWith(['60200002', '60200003', '60201394']);
    expect(api.getSecureWalkingMatrix).toHaveBeenCalledWith({ origins: [{ lat: 48.2, lng: 16.3 }],
      destinations: [{ lat: 48.2, lng: 16.3 }, { lat: 48.201, lng: 16.3 }, { lat: 48.202, lng: 16.3 }] });
    expect(highlightedStations()).toEqual(['Tscherttegasse', 'Second station', 'Third station']);
    const card = cards()[0];
    expect(cards()).toHaveLength(1);
    expect(card.textContent).toContain('Tscherttegasse');
    expect(card.querySelector('.overlay-close-button')).toBeNull();
    resize(true); resize(false);
    expect(cards()).toEqual([card]);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(1);
  });

  it('keeps the closest card without a close button when its dot is selected on desktop and mobile', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    const card = cards()[0];
    select('Tscherttegasse');
    expect(cards()).toEqual([card]);
    expect(card.querySelector('.overlay-close-button')).toBeNull();
    expect(document.activeElement).toBe(card.querySelector('.station-name'));
    resize(true);
    select('Tscherttegasse');
    expect(cards()).toEqual([card]);
    expect(card.querySelector('.overlay-close-button')).toBeNull();
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(1);
    expect(highlightedStations()).toHaveLength(3);
    coordinates.next({ latitude: 48.2011, longitude: 16.3, timestamp: 100000 });
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Second station');
    expect(cards()[0].querySelector('.overlay-close-button')).toBeNull();
  });

  it('returns to the default card and drops outside polling membership when the closest dot is selected', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    select('Fourth station');
    expect(selectedCard().querySelector('.overlay-close-button')).not.toBeNull();
    select('Tscherttegasse');
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Tscherttegasse');
    expect(cards()[0].querySelector('.overlay-close-button')).toBeNull();
    expect(api.getRealTimeDepartures.mock.calls.at(-1)![0]).toEqual(['60200002', '60200003', '60201394']);
    expect(highlightedStations()).toHaveLength(3);
  });

  it('focuses the closest card title when chosen from the picker without adding a close button', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    const trigger = fixture.nativeElement.querySelector('button[aria-label="Choose a station"]') as HTMLButtonElement;
    trigger.click(); fixture.detectChanges();
    const picker = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    picker.value = '1'; picker.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(cards()[0].textContent).toContain('Tscherttegasse');
    expect(cards()[0].querySelector('.overlay-close-button')).toBeNull();
    expect(document.activeElement).toBe(cards()[0].querySelector('.station-name'));
    cards()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cards()).toHaveLength(1);
  });

  it('does not add stations outside the radius when only two stations are returned', () => {
    api.getNearbySteige.mockReturnValue(of(nearbyPlatforms.filter(platform => platform.fk_haltestellen_id === 2 || platform.fk_haltestellen_id === 3)));
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    expect(api.getNearbySteige).toHaveBeenCalledWith(48.2, 16.3, 800);
    expect(api.getRealTimeDepartures).toHaveBeenCalledWith(['60200002', '60200003']);
    expect(api.getSecureWalkingMatrix.mock.calls[0][0].destinations).toHaveLength(2);
    expect(highlightedStations()).toEqual(['Second station', 'Third station']);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Second station');
  });

  it('does not show cards or start departure or walking requests when no stations are in range', () => {
    api.getNearbySteige.mockReturnValue(of([]));
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    expect(api.getRealTimeDepartures).not.toHaveBeenCalled();
    expect(api.getSecureWalkingMatrix).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(0);
    expect(highlightedStations()).toHaveLength(0);
  });

  it('opens preloaded departures without another request and returns to the closest card on close', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    const cached = structuredClone(monitorSample);
    cached.data!.monitors[0].locationStop.properties.name = '60200002';
    response.next({ ...cached, timestamp: Date.now() });
    select('Second station');
    expect(cards()).toHaveLength(1);
    expect(selectedCard().textContent).toContain('Floridsdorf');
    expect(selectedCard().textContent).not.toContain('Loading');
    expect(highlightedStations()).toHaveLength(3);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(1);
    selectedCard().querySelector<HTMLButtonElement>('.overlay-close-button')!.click();
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Tscherttegasse');
    expect(highlightedStations()).toHaveLength(3);
  });

  it('keeps the nearest three loaded while a station outside that set is selected', () => {
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    select('Fourth station');
    expect(cards()).toHaveLength(1);
    expect(selectedCard().textContent).toContain('Fourth station');
    expect(api.getRealTimeDepartures.mock.calls.at(-1)![0]).toEqual(['60200002', '60200003', '60200004', '60201394']);
    expect(highlightedStations()).toHaveLength(4);
    coordinates.next({ latitude: 48.2299, longitude: 16.3, timestamp: 2000000 });
    expect(cards()).toHaveLength(1);
    expect(selectedCard().textContent).toContain('Fourth station');
    selectedCard().querySelector<HTMLButtonElement>('.overlay-close-button')!.click();
    vi.advanceTimersByTime(0);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Fourth station');
    expect(cards()[0].querySelector('.selected')).toBeNull();
    expect(highlightedStations()).toHaveLength(3);
  });

  it('removes SDK listeners, Angular views and polling on real teardown', () => {
    select('Tscherttegasse');
    fixture.destroy();
    const calls = api.getRealTimeDepartures.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60000);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(calls);
    expect(sdk.maps[0].listeners.size).toBe(0);
    expect(sdk.markers.every(marker => marker.map === null && marker.listeners.size === 0)).toBe(true);
    expect(sdk.polylines.every(polyline => polyline.listeners.size === 0)).toBe(true);
    expect(cards()).toHaveLength(0);
  });

  it('shows the closest card without walking results, with only the selected card on mobile', () => {
    resize(true);
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    vi.advanceTimersByTime(0);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector('.walking-time')).toBeNull();
    select('Third station');
    expect(cards()).toHaveLength(1);
    expect(selectedCard().textContent).toContain('Third station');
  });

  it('preserves the card and focused close button through polling and breakpoint changes', () => {
    select('Tscherttegasse');
    const card = selectedCard();
    const close = card.querySelector<HTMLButtonElement>('.overlay-close-button')!;
    close.focus();
    response.next({ ...monitorSample, timestamp: Date.now() });
    expect(selectedCard()).toBe(card);
    expect(document.activeElement).toBe(close);
    resize(true); resize(false);
    expect(selectedCard()).toBe(card);
    expect(document.activeElement).toBe(close);
    expect(api.getRealTimeDepartures).toHaveBeenCalledTimes(1);
  });

  it('supports choosing a station and Escape dismissal with focus restored to its control', () => {
    const trigger = fixture.nativeElement.querySelector('button[aria-label="Choose a station"]') as HTMLButtonElement;
    trigger.click(); fixture.detectChanges();
    const picker = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(document.activeElement).toBe(picker);
    picker.value = '2'; picker.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(selectedCard().textContent).toContain('Second station');
    expect(sdk.maps[0].panTo).toHaveBeenCalledWith({ lat: 48.201, lng: 16.3 });
    expect(document.activeElement).toBe(selectedCard().querySelector('.overlay-close-button'));
    selectedCard().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cards()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it('renders external direction text as text rather than markup', () => {
    select('Tscherttegasse');
    const monitor = structuredClone(monitorSample);
    monitor.data!.monitors[0].lines[0].towards = '<img src=x onerror=alert(1)>';
    response.next({ ...monitor, timestamp: Date.now() });
    expect(selectedCard().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(selectedCard().querySelector('img')).toBeNull();
  });

  it('retains earlier departures with a stale status after a failed refresh', () => {
    select('Tscherttegasse');
    response.next({ ...monitorSample, timestamp: Date.now() });
    const status = selectedCard().querySelector('[role="status"]');
    response.error(new Error('Provider unavailable'));
    expect(selectedCard().textContent).toContain('Floridsdorf');
    expect(selectedCard().textContent).toContain('Showing earlier departures');
    expect(selectedCard().querySelector('[role="status"]')).toBe(status);
  });

  it('uses physical station coordinates for walking while preserving display marker positions', () => {
    fixture.destroy();
    const physicalCatalog = structuredClone(catalog);
    physicalCatalog.lines['306'].stops.features[0].properties.physical_location = { type: 'Point', coordinates: [16.301, 48.201] };
    api.getMetroLineStops.mockReturnValue(of(physicalCatalog));
    fixture = TestBed.createComponent(MapViewComponent);
    fixture.detectChanges();
    coordinates.next({ latitude: 48.2, longitude: 16.3, timestamp: 1000 });
    expect(api.getSecureWalkingMatrix).toHaveBeenCalledWith({ origins: [{ lat: 48.2, lng: 16.3 }],
      destinations: [{ lat: 48.201, lng: 16.301 }, { lat: 48.201, lng: 16.3 }, { lat: 48.202, lng: 16.3 }] });
    expect(cards()[0].textContent).toContain('Second station');
    expect(sdk.markers.filter(marker => marker.getTitle() === 'Tscherttegasse').every(marker => marker.getPosition().lat() === 48.2)).toBe(true);
  });

  it('marks retained departures stale and explains unavailable live data while offline', () => {
    select('Tscherttegasse');
    response.next({ ...monitorSample, timestamp: Date.now() });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You are offline');
    expect(selectedCard().textContent).toContain('Showing earlier departures');
    expect(selectedCard().textContent).toContain('Floridsdorf');
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('You are offline');
  });
});
