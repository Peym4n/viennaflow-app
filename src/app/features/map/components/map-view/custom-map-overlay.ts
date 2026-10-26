/// <reference types="google.maps" />

export interface ICustomMapOverlay {
  setMap(map: google.maps.Map | null): void;
  setPresentation(mobile: boolean, selected: boolean): void;
  draw(): void;
  destroy(): void;
}

export type CustomMapOverlayConstructor = new (position: google.maps.LatLngLiteral, content: HTMLElement) => ICustomMapOverlay;

interface OverlayBox { left: number; top: number; width: number; height: number; }

/** Fit a card near its station while keeping preceding cards readable. */
export function placeOverlay(preferred: OverlayBox, width: number, height: number, occupied: OverlayBox[]): OverlayBox {
  const margin = 12;
  const clamp = (value: number, limit: number) => Math.max(margin, Math.min(value, limit));
  const xs = [preferred.left, ...occupied.flatMap(box => [box.left - preferred.width - margin, box.left + box.width + margin])];
  const ys = [preferred.top, ...occupied.flatMap(box => [box.top - preferred.height - margin, box.top + box.height + margin])];
  const candidates = xs.flatMap(left => ys.map(top => ({ ...preferred,
    left: clamp(left, width - preferred.width - margin), top: clamp(top, height - preferred.height - margin),
  })));
  const overlap = (box: OverlayBox) => occupied.reduce((area, other) => area +
    Math.max(0, Math.min(box.left + box.width + margin, other.left + other.width + margin) - Math.max(box.left, other.left)) *
    Math.max(0, Math.min(box.top + box.height + margin, other.top + other.height + margin) - Math.max(box.top, other.top)), 0);
  const distance = (box: OverlayBox) => (box.left - preferred.left) ** 2 + (box.top - preferred.top) ** 2;
  return candidates.sort((a, b) => overlap(a) - overlap(b) || distance(a) - distance(b))[0];
}

/** Define the SDK subclass only after Maps has loaded. Angular owns the content. */
export function createCustomMapOverlayClass(mapsApi: typeof google.maps): CustomMapOverlayConstructor {
  const active = new Set<CustomMapOverlay>();
  class CustomMapOverlay extends mapsApi.OverlayView implements ICustomMapOverlay {
    private readonly host = document.createElement('div');
    private readonly observer = new ResizeObserver(() => this.draw());
    private mobile = false;
    private selected = false;

    constructor(private readonly position: google.maps.LatLngLiteral, content: HTMLElement) {
      super();
      this.host.className = 'station-overlay-host';
      Object.assign(this.host.style, { position: 'absolute', pointerEvents: 'auto', overflow: 'auto' });
      this.host.appendChild(content);
      mapsApi.OverlayView.preventMapHitsAndGesturesFrom(this.host);
    }

    override onAdd(): void {
      active.add(this);
      this.attach();
      this.observer.observe(this.host);
    }

    private attach(): void {
      const map = this.getMap();
      const parent = this.mobile ? (map && 'getDiv' in map ? map.getDiv() : null) : this.getPanes()?.overlayMouseTarget;
      if (parent && this.host.parentNode !== parent) {
        const focused = this.host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
        parent.appendChild(this.host);
        focused?.focus({ preventScroll: true });
      }
    }

    setPresentation(mobile: boolean, selected: boolean): void {
      this.mobile = mobile;
      this.selected = selected;
      this.host.style.zIndex = selected ? '1001' : '1000';
      this.attach();
      this.draw();
    }

    override draw(): void {
      const occupied: OverlayBox[] = [];
      for (const overlay of [...active].sort((a, b) => Number(b.selected) - Number(a.selected))) {
        const box = overlay.positionCard(occupied);
        if (box && !overlay.mobile) occupied.push(box);
      }
    }

    private positionCard(occupied: OverlayBox[]): OverlayBox | undefined {
      const map = this.getMap();
      if (!map || !('getDiv' in map)) return;
      const { width, height } = map.getDiv().getBoundingClientRect();
      if (!width || !height) return;
      const margin = 12;
      const availableWidth = this.mobile ? width : width - 80;
      this.host.style.width = 'max-content';
      this.host.style.maxWidth = `${Math.max(0, availableWidth - margin * 2)}px`;
      this.host.style.maxHeight = `${Math.max(72, this.mobile ? height * 0.48 - 36 : height - margin * 2)}px`;
      if (this.mobile) {
        this.host.style.left = `${(width - this.host.offsetWidth) / 2}px`;
        this.host.style.top = `${height - this.host.offsetHeight - 28}px`;
        return;
      }
      const projection = this.getProjection();
      const position = new mapsApi.LatLng(this.position.lat, this.position.lng);
      const point = projection?.fromLatLngToDivPixel(position);
      const containerPoint = projection?.fromLatLngToContainerPixel(position);
      if (!point || !containerPoint) return;
      const above = containerPoint.y - this.host.offsetHeight - margin;
      const box = placeOverlay({ left: containerPoint.x - this.host.offsetWidth / 2,
        top: above < margin ? containerPoint.y + margin : above,
        width: this.host.offsetWidth, height: this.host.offsetHeight }, availableWidth, height, occupied);
      this.host.style.left = `${point.x + box.left - containerPoint.x}px`;
      this.host.style.top = `${point.y + box.top - containerPoint.y}px`;
      return box;
    }

    override onRemove(): void {
      this.observer.disconnect();
      active.delete(this);
      this.host.remove();
    }

    destroy(): void {
      this.setMap(null);
      this.observer.disconnect();
      this.host.remove();
      active.delete(this);
    }
  }
  return CustomMapOverlay;
}
