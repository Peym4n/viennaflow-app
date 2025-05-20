/// <reference types="google.maps" />

export interface ICustomMapOverlay {
  setMap(map: google.maps.Map | null): void;
  setContent(content: string | HTMLElement): void;
  setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral): void;
  show(): void;
  hide(): void;
  destroy(): void; // Method to clean up and remove the overlay
  // Add other methods as needed
}

export type CustomMapOverlayConstructor = new (
  position: google.maps.LatLng | google.maps.LatLngLiteral,
  content: string | HTMLElement,
  map?: google.maps.Map
) => ICustomMapOverlay;

export function createCustomMapOverlayClass(mapsApi: typeof google.maps): CustomMapOverlayConstructor {
  class CustomMapOverlayInternal extends mapsApi.OverlayView implements ICustomMapOverlay {
    private position: google.maps.LatLng;
    private content: string | HTMLElement;
    private div?: HTMLDivElement;

    constructor(
      position: google.maps.LatLng | google.maps.LatLngLiteral,
      content: string | HTMLElement,
      map?: google.maps.Map
    ) {
      super();
      this.position = new mapsApi.LatLng(position);
      this.content = content;
      if (map) {
        this.setMap(map);
      }
    }

    setContent(content: string | HTMLElement): void {
      this.content = content;
      if (this.div) {
        if (typeof content === 'string') {
          this.div.innerHTML = content;
        } else {
          this.div.innerHTML = '';
          this.div.appendChild(content);
        }
      }
    }

    setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral): void {
      this.position = new mapsApi.LatLng(position);
      if (this.div) {
        this.draw();
      }
    }

    show(): void {
      if (this.div) {
        this.div.style.visibility = 'visible';
      }
    }

    hide(): void {
      if (this.div) {
        this.div.style.visibility = 'hidden';
      }
    }

    override onAdd() {
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      // Default styling - can be overridden by CSS classes applied to the content
      this.div.style.border = '2px dashed cyan'; // Highly visible border
      this.div.style.background = 'rgba(255, 0, 255, 0.7)'; // Semi-transparent magenta
      this.div.style.padding = '8px';
      this.div.style.borderRadius = '4px';
      // this.div.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'; // Remove shadow for now
      this.div.style.zIndex = '9999'; // Extremely high z-index
      this.div.style.minWidth = '30px'; // Ensure minimum size
      this.div.style.minHeight = '20px'; // Ensure minimum size
      this.div.style.visibility = 'visible'; // Force visibility
      this.div.style.opacity = '1'; // Force opacity
      this.div.style.color = 'black'; // Ensure text is visible against magenta

      console.log('[CustomMapOverlay] onAdd called. Div created with forced debug styles.', this.div);

      if (typeof this.content === 'string') {
        this.div.innerHTML = this.content;
      } else {
        this.div.appendChild(this.content);
      }
      console.log(`[CustomMapOverlay] Content set. offsetWidth: ${this.div.offsetWidth}, offsetHeight: ${this.div.offsetHeight}`);

      const panes = this.getPanes();
      if (panes && panes.overlayLayer) { 
        panes.overlayLayer.appendChild(this.div);
        console.log('[CustomMapOverlay] Appended to overlayLayer.');
      } else if (panes && panes.floatPane) { 
        console.warn('[CustomMapOverlay] overlayLayer not available, falling back to floatPane');
        panes.floatPane.appendChild(this.div);
      } else {
        console.error('[CustomMapOverlay] No suitable map pane found for overlay.');
      }
    }

    override draw() {
      const overlayProjection = this.getProjection();
      if (!this.div || !overlayProjection) {
        // console.warn('[CustomMapOverlay] draw: No div or projection.'); // Keep console cleaner
        return;
      }

      const sw = overlayProjection.fromLatLngToDivPixel(this.position);
      if (!sw) {
        // console.warn('[CustomMapOverlay] draw: fromLatLngToDivPixel returned null.');
        return;
      }

      const overlayWidth = this.div.offsetWidth;
      const overlayHeight = this.div.offsetHeight;
      const VERTICAL_OFFSET = 10; // Pixels to appear above the anchor point

      const finalLeft = sw.x - (overlayWidth / 2);
      const finalTop = sw.y - overlayHeight - VERTICAL_OFFSET;

      this.div.style.left = finalLeft + 'px';
      this.div.style.top = finalTop + 'px';

      // console.log(`[CustomMapOverlay] draw - Anchor: (${sw.x}, ${sw.y}), Overlay W/H: (${overlayWidth}, ${overlayHeight}), Final style: left=${this.div.style.left}, top=${this.div.style.top}`);
    }

    override onRemove() {
      console.log('[CustomMapOverlay] onRemove called.', this.div);
      if (this.div && this.div.parentNode) {
        (this.div.parentNode as HTMLElement).removeChild(this.div);
        this.div = undefined;
      }
    }

    destroy() {
      console.log('[CustomMapOverlay] destroy called.', this.div);
      this.setMap(null);
    }
  }
  return CustomMapOverlayInternal;
} 