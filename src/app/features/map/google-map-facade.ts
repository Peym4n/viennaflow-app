import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, NgZone, createComponent, inject } from '@angular/core';
import { LatLng } from '@shared-types/api-models';
import { LineStopsResponse } from '../../core/services/api.service';
import { environment } from '../../../environments/environment';
import { MapStation, StationCard } from './map-presentation';
import { StationCardComponent } from './components/station-card/station-card.component';
import { CustomMapOverlayConstructor, ICustomMapOverlay, createCustomMapOverlayClass } from './components/map-view/custom-map-overlay';

interface MapActions {
  selectStation: (id: number) => void;
  closeStation: (id: number) => void;
  copyCoordinates: (position: LatLng) => void;
}

export interface MapScene {
  cards: StationCard[];
  nearbyIds: ReadonlySet<number>;
  selectedId: number | null;
  mobile: boolean;
  showStations: boolean;
  showLines: boolean;
}

/** Feature-scoped owner of SDK objects and Angular views mounted into overlays. */
@Injectable()
export class GoogleMapFacade {
  private readonly app = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly zone = inject(NgZone);
  private map: google.maps.Map | null = null;
  private userMarker: google.maps.Marker | null = null;
  private previousPosition: LatLng | null = null;
  private mobile: boolean | null = null;
  private stationsVisible = false;
  private linesVisible = true;
  private readonly stationIcons = new Map<string, google.maps.Icon | google.maps.Symbol>();
  private readonly markers = new Map<number, google.maps.Marker>();
  private readonly highlights = new Map<number, google.maps.Marker>();
  private readonly polylines: google.maps.Polyline[] = [];
  private readonly cards = new Map<number, { overlay: ICustomMapOverlay; component: ComponentRef<StationCardComponent> }>();
  private overlayClass!: CustomMapOverlayConstructor;
  private actions!: MapActions;
  private stations: ReadonlyMap<number, MapStation> = new Map();
  private readonly resize = new ResizeObserver(() => this.cards.forEach(card => card.overlay.draw()));

  initialize(container: HTMLElement, catalog: LineStopsResponse, stations: ReadonlyMap<number, MapStation>, actions: MapActions): void {
    this.actions = actions;
    this.stations = stations;
    this.overlayClass = createCustomMapOverlayClass(google.maps);
    this.map = new google.maps.Map(container, {
      center: { lat: 48.2082, lng: 16.3738 }, zoom: 13,
      mapId: environment.googleMaps.mapId || 'vienna_metro_map', gestureHandling: 'greedy',
      mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
      zoomControl: true, zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
    });
    const copy = (event: google.maps.MapMouseEvent) => {
      const position = event.latLng;
      if (position) this.zone.run(() => actions.copyCoordinates({ lat: position.lat(), lng: position.lng() }));
    };
    this.map.addListener('rightclick', copy);
    this.map.addListener('bounds_changed', () => this.cards.forEach(card => card.overlay.draw()));
    this.resize.observe(container);
    for (const line of Object.values(catalog.lines)) {
      for (const geometry of line.lineStrings ?? []) {
        if (geometry.coordinates.length < 2) continue;
        const polyline = new google.maps.Polyline({
          path: geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), map: this.map,
          geodesic: true, strokeColor: line.farbe, strokeOpacity: 1, strokeWeight: 4,
        });
        polyline.addListener('rightclick', copy);
        this.polylines.push(polyline);
      }
    }
    for (const station of stations.values()) this.markers.set(station.id, this.makeMarker(station, 'white', false));
  }

  render(scene: MapScene): void {
    if (!this.map) return;
    if (this.mobile !== scene.mobile) {
      const position = scene.mobile ? google.maps.ControlPosition.LEFT_TOP : google.maps.ControlPosition.RIGHT_CENTER;
      this.map.setOptions({ zoomControlOptions: { position }, cameraControlOptions: { position } });
      this.mobile = scene.mobile;
    }
    if (this.stationsVisible !== scene.showStations) {
      this.markers.forEach(marker => marker.setVisible(scene.showStations));
      this.stationsVisible = scene.showStations;
    }
    if (this.linesVisible !== scene.showLines) {
      this.polylines.forEach(polyline => polyline.setVisible(scene.showLines));
      this.linesVisible = scene.showLines;
    }
    const highlighted = new Set(scene.nearbyIds);
    if (scene.selectedId !== null) highlighted.add(scene.selectedId);
    for (const [id, marker] of this.highlights) {
      if (!highlighted.has(id)) { this.removeMarker(marker); this.highlights.delete(id); }
    }
    for (const id of highlighted) {
      const station = this.stations.get(id);
      if (!station) continue;
      let marker = this.highlights.get(id);
      const color = scene.selectedId === id ? '#ADD8E6' : '#6495ED';
      if (!marker) {
        marker = this.makeMarker(station, color, true);
        this.highlights.set(id, marker);
      } else {
        const icon = marker.getIcon() as google.maps.Symbol;
        if (icon.fillColor !== color) marker.setIcon({ ...icon, fillColor: color });
      }
    }
    const wanted = new Set(scene.cards.map(card => card.station.id));
    for (const [id, card] of this.cards) {
      if (!wanted.has(id)) {
        card.overlay.destroy();
        this.app.detachView(card.component.hostView);
        card.component.destroy();
        this.cards.delete(id);
      }
    }
    for (const data of scene.cards) {
      let card = this.cards.get(data.station.id);
      if (!card) {
        const component = createComponent(StationCardComponent, { environmentInjector: this.injector });
        component.setInput('card', data);
        component.instance.select.subscribe(() => this.zone.run(() => this.actions.selectStation(data.station.id)));
        component.instance.close.subscribe(() => this.zone.run(() => this.actions.closeStation(data.station.id)));
        this.app.attachView(component.hostView);
        component.changeDetectorRef.detectChanges();
        const overlay = new this.overlayClass(data.station.position, component.location.nativeElement);
        card = { component, overlay };
        this.cards.set(data.station.id, card);
        overlay.setMap(this.map);
      } else {
        card.component.setInput('card', data);
        card.component.changeDetectorRef.detectChanges();
      }
      card.overlay.setPresentation(scene.mobile, data.selected);
    }
  }

  focusCard(id: number): void {
    const element = this.cards.get(id)?.component.location.nativeElement as HTMLElement | undefined;
    const target = element?.querySelector<HTMLButtonElement>('.overlay-close-button')
      ?? element?.querySelector<HTMLButtonElement>('.station-name');
    target?.focus({ preventScroll: true });
  }

  updatePosition(position: LatLng): void {
    if (!this.map) return;
    if (!this.userMarker) {
      this.userMarker = new google.maps.Marker({
        position, map: this.map, title: 'Your location',
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285F4', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2 },
      });
      this.map.setCenter(position);
      this.map.setZoom(15);
    } else {
      this.userMarker.setPosition(position);
      if (this.previousPosition && this.distance(position, this.previousPosition) > 1000) this.recenter();
    }
    this.previousPosition = position;
  }

  distance(a: LatLng, b: LatLng): number { return google.maps.geometry.spherical.computeDistanceBetween(a, b); }

  recenter(): void {
    const position = this.userMarker?.getPosition();
    if (position && this.map) { this.map.panTo(position); this.map.setZoom(15); }
  }

  showStation(id: number): void {
    const station = this.stations.get(id);
    if (station && this.map) this.map.panTo(station.position);
  }

  destroy(): void {
    this.resize.disconnect();
    this.cards.forEach(card => {
      card.overlay.destroy();
      this.app.detachView(card.component.hostView);
      card.component.destroy();
    });
    this.cards.clear();
    [...this.markers.values(), ...this.highlights.values()].forEach(marker => this.removeMarker(marker));
    this.markers.clear();
    this.highlights.clear();
    this.polylines.forEach(polyline => { google.maps.event.clearInstanceListeners(polyline); polyline.setMap(null); });
    this.polylines.length = 0;
    if (this.userMarker) this.removeMarker(this.userMarker);
    this.userMarker = null;
    if (this.map) google.maps.event.clearInstanceListeners(this.map);
    this.map = null;
    this.mobile = null;
    this.stationsVisible = false;
    this.linesVisible = true;
    this.stationIcons.clear();
  }

  private makeMarker(station: MapStation, fillColor: string, highlight: boolean): google.maps.Marker {
    const marker = new google.maps.Marker({
      // Separate markers retain keyboard access; shared PNG icons keep vector-map panning inexpensive.
      position: station.position, map: this.map, title: station.name, visible: highlight, optimized: false,
      icon: highlight
        ? { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor, fillOpacity: 1, strokeColor: station.color, strokeWeight: 3 }
        : this.stationIcon(station.color),
      ...(highlight ? { zIndex: google.maps.Marker.MAX_ZINDEX + 1 } : {}),
    });
    marker.addListener('click', () => this.zone.run(() => this.actions.selectStation(station.id)));
    return marker;
  }

  private stationIcon(color: string): google.maps.Icon | google.maps.Symbol {
    const cached = this.stationIcons.get(color);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 60;
    const context = canvas.getContext('2d');
    let icon: google.maps.Icon | google.maps.Symbol;
    if (context) {
      // Render once at 3x resolution, retaining the existing circle size and line color.
      context.scale(3, 3);
      context.beginPath();
      context.arc(10, 10, 7, 0, 2 * Math.PI);
      context.fillStyle = 'white';
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.stroke();
      icon = { url: canvas.toDataURL('image/png'), scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) };
    } else {
      icon = { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: 'white', fillOpacity: 1, strokeColor: color, strokeWeight: 3 };
    }
    this.stationIcons.set(color, icon);
    return icon;
  }

  private removeMarker(marker: google.maps.Marker): void {
    google.maps.event.clearInstanceListeners(marker);
    marker.setMap(null);
  }
}
