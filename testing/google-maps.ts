import { vi } from 'vitest';

/** Small SDK double that exposes map events and keeps overlay DOM inspectable. */
export function installGoogleMaps() {
  const markers: Marker[] = [];
  const maps: MapDouble[] = [];
  const polylines: Polyline[] = [];
  const pane = document.createElement('div');
  document.body.appendChild(pane);

  class LatLng {
    constructor(private latitude: number, private longitude: number) {}
    lat() { return this.latitude; }
    lng() { return this.longitude; }
    equals(other: LatLng) { return this.lat() === other.lat() && this.lng() === other.lng(); }
  }
  class Events {
    listeners = new Map<string, (() => void)[]>();
    addListener(name: string, callback: () => void) {
      const callbacks = this.listeners.get(name) ?? [];
      this.listeners.set(name, [...callbacks, callback]);
      return { remove: () => this.listeners.set(name, callbacks.filter(cb => cb !== callback)) };
    }
    trigger(name: string) { this.listeners.get(name)?.slice().forEach(callback => callback()); }
  }
  class MapDouble extends Events {
    constructor(private readonly element: HTMLElement, readonly options: google.maps.MapOptions) { super(); maps.push(this); }
    getDiv() { return this.element; }
    setOptions(options: google.maps.MapOptions) { Object.assign(this.options, options); }
    setCenter = vi.fn();
    setZoom = vi.fn();
    panTo = vi.fn();
  }
  class Marker extends Events {
    static MAX_ZINDEX = 1000;
    map: unknown;
    position: LatLng;
    constructor(readonly options: google.maps.MarkerOptions) {
      super();
      const position = options.position as google.maps.LatLngLiteral;
      this.position = position instanceof LatLng ? position : new LatLng(position.lat, position.lng);
      this.map = options.map;
      markers.push(this);
    }
    getPosition() { return this.position; }
    setPosition(position: LatLng) { this.position = position; }
    getTitle() { return this.options.title; }
    getIcon() { return this.options.icon; }
    setIcon(icon: google.maps.Symbol) { this.options.icon = icon; }
    setMap(map: unknown) { this.map = map; }
    setVisible = vi.fn();
  }
  class OverlayView {
    static preventMapHitsAndGesturesFrom = vi.fn();
    private attachedMap: unknown;
    setMap(map: unknown) {
      if (map === this.attachedMap) return;
      if (this.attachedMap) this.onRemove();
      this.attachedMap = map;
      if (map) { this.onAdd(); this.draw(); }
    }
    getMap() { return this.attachedMap; }
    getPanes() { return { overlayMouseTarget: pane }; }
    getProjection() { return {
      fromLatLngToDivPixel: () => ({ x: 100, y: 100 }),
      fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }),
    }; }
    onAdd() {}
    onRemove() {}
    draw() {}
  }
  class Polyline extends Events {
    constructor(_options: unknown) { super(); polylines.push(this); }
    setMap = vi.fn();
    setVisible = vi.fn();
  }
  vi.stubGlobal('google', { maps: {
    Map: MapDouble, Marker, OverlayView, Polyline, LatLng,
    SymbolPath: { CIRCLE: 0 }, ControlPosition: { RIGHT_CENTER: 1, LEFT_TOP: 2 },
    geometry: { spherical: { computeDistanceBetween: (a: LatLng | google.maps.LatLngLiteral, b: LatLng | google.maps.LatLngLiteral) => {
      const lat = (point: LatLng | google.maps.LatLngLiteral) => typeof point.lat === 'function' ? point.lat() : point.lat;
      const lng = (point: LatLng | google.maps.LatLngLiteral) => typeof point.lng === 'function' ? point.lng() : point.lng;
      return Math.hypot(lat(a) - lat(b), lng(a) - lng(b)) * 111000;
    } } },
    event: {
      addListenerOnce: (target: Events, name: string, callback: () => void) => {
        const listener = target.addListener(name, () => { listener.remove(); callback(); });
        return listener;
      },
      clearListeners: (target: Events, name: string) => target.listeners.delete(name),
      clearInstanceListeners: (target: Events) => target.listeners.clear(),
    },
  } });
  return { markers, maps, polylines, pane, dispose: () => pane.remove() };
}
