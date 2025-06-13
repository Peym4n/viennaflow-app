/// <reference types="google.maps" />

export interface ICustomMapOverlay {
  setMap(map: google.maps.Map | null): void;
  setContent(content: string | HTMLElement): void;
  setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral): void;
  show(): void;
  hide(): void;
  destroy(): void; // Method to clean up and remove the overlay
  getDiv(): HTMLDivElement | undefined; // Method to access the overlay's div element
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
        this.draw();
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
      // Ensure the overlay container itself is interactive and blocks clicks to map below.
      this.div.style.pointerEvents = 'auto'; 

      // Add click event listener to the overlay div itself
      this.div.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        return false;
      }, true);

      // Visual styling (background, border, padding, text color) should be handled by the
      // CSS classes applied to the HTML content set via innerHTML.
      // Retain essential styles for overlay functionality:
      // this.div.style.zIndex = '9999'; // zIndex can be useful, but let's see if default pane order is enough.
                                      // If needed, it can be set here or managed via map panes.

      // The following debug/default styles are removed to allow full CSS control from the component:
      // this.div.style.border = '2px dashed cyan';
      // this.div.style.background = 'rgba(255, 0, 255, 0.7)';
      // this.div.style.padding = '8px';
      // this.div.style.borderRadius = '4px';
      // this.div.style.color = 'black';
      
      // Styles like minWidth/minHeight might be useful if content can be empty, but generally also better in CSS.
      // this.div.style.minWidth = '30px';
      // this.div.style.minHeight = '20px';

      // Visibility and opacity should be controlled by show()/hide() or CSS if needed.
      // this.div.style.visibility = 'visible';
      // this.div.style.opacity = '1';

      if (typeof this.content === 'string') {
        this.div.innerHTML = this.content;
      } else {
        this.div.appendChild(this.content);
      }

      const panes = this.getPanes();
      // Prioritize floatPane for custom overlays to appear above polylines and markers.
      if (panes && panes.floatPane) { 
        panes.floatPane.appendChild(this.div);
      } else if (panes && panes.overlayLayer) { // Fallback if floatPane is not available
        panes.overlayLayer.appendChild(this.div);
      } else {
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

      // Ensure the overlay and its content are properly handling pointer events
      if (this.div) {
        this.div.style.pointerEvents = 'auto';
        const contentElement = this.div.firstElementChild as HTMLElement;
        if (contentElement) {
          contentElement.style.pointerEvents = 'auto';
          // Set pointer-events: auto on all children
          contentElement.querySelectorAll('*').forEach(element => {
            (element as HTMLElement).style.pointerEvents = 'auto';
          });
        }
      }
    }

    override onRemove() {
      // console.log('[CustomMapOverlay] onRemove called.', this.div);
      if (this.div && this.div.parentNode) {
        (this.div.parentNode as HTMLElement).removeChild(this.div);
        this.div = undefined;
      }
    }

    destroy() {
      // console.log('[CustomMapOverlay] destroy called.', this.div);
      this.setMap(null);
    }

    getDiv(): HTMLDivElement | undefined {
      return this.div;
    }
  }
  return CustomMapOverlayInternal;
}