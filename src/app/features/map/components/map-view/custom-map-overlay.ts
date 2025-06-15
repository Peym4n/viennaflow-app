/// <reference types="google.maps" />

export interface ICustomMapOverlay {
  setMap(map: google.maps.Map | null): void;
  setContent(content: string | HTMLElement): void;
  setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral): void;
  show(): void;
  hide(): void;
  destroy(): void;
  getDiv(): HTMLDivElement;
}

export type CustomMapOverlayConstructor = new (
  position: google.maps.LatLng | google.maps.LatLngLiteral,
  content: string | HTMLElement
) => ICustomMapOverlay;

export function createCustomMapOverlayClass(mapsApi: typeof google.maps): CustomMapOverlayConstructor {
  return class extends mapsApi.OverlayView implements ICustomMapOverlay {
    private content: HTMLDivElement;
    private position: google.maps.LatLng;
    private map: google.maps.Map | null = null;
    private stationId: number | null = null;
    private visible: boolean = true;
    private closeButtonHandler: ((e: Event) => void) | null = null;

    constructor(position: google.maps.LatLng | google.maps.LatLngLiteral, content: string | HTMLElement) {
      super();
      this.position = position instanceof google.maps.LatLng ? position : new google.maps.LatLng(position.lat, position.lng);
      
      // Create container
      this.content = document.createElement('div');
      this.content.style.position = 'absolute';
      this.content.style.pointerEvents = 'auto';
      this.content.style.zIndex = '1000';
      
      // Create inner content
      const innerContent = document.createElement('div');
      innerContent.innerHTML = typeof content === 'string' ? content : content.innerHTML;
      this.content.appendChild(innerContent);

      // Extract station ID from content if it exists
      const closeButton = innerContent.querySelector('.overlay-close-button');
      if (closeButton) {
        const stationIdAttr = closeButton.getAttribute('data-station-id');
        if (stationIdAttr) {
          this.stationId = parseInt(stationIdAttr, 10);
          this.closeButtonHandler = (e: Event) => {
            console.log('[MapView] Close button clicked for station:', this.stationId);
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('closeOverlay', { 
              detail: { stationId: this.stationId } 
            }));
          };
          closeButton.addEventListener('click', this.closeButtonHandler);
        }
      }
    }

    override onAdd(): void {
      if (this.map) {
        this.getPanes()?.overlayMouseTarget.appendChild(this.content);
      }
    }

    override draw(): void {
      if (!this.map) return;

      const projection = this.getProjection();
      if (!projection) return;

      const point = projection.fromLatLngToDivPixel(this.position);
      if (!point) return;

      // Center the overlay on the marker
      const offsetX = -this.content.offsetWidth / 2;
      const offsetY = -this.content.offsetHeight - 10; // 10px above the marker

      this.content.style.left = (point.x + offsetX) + 'px';
      this.content.style.top = (point.y + offsetY) + 'px';
    }

    override onRemove(): void {
      // Remove event listener before removing the content
      if (this.closeButtonHandler) {
        const closeButton = this.content.querySelector('.overlay-close-button');
        if (closeButton) {
          closeButton.removeEventListener('click', this.closeButtonHandler);
        }
      }
      this.content.parentNode?.removeChild(this.content);
    }

    setContent(content: string | HTMLElement): void {
      // Remove old event listener if it exists
      if (this.closeButtonHandler) {
        const oldCloseButton = this.content.querySelector('.overlay-close-button');
        if (oldCloseButton) {
          oldCloseButton.removeEventListener('click', this.closeButtonHandler);
        }
      }

      this.content.innerHTML = typeof content === 'string' ? content : content.innerHTML;
      
      // Add new event listener
      const closeButton = this.content.querySelector('.overlay-close-button');
      if (closeButton) {
        const stationIdAttr = closeButton.getAttribute('data-station-id');
        if (stationIdAttr) {
          this.stationId = parseInt(stationIdAttr, 10);
          this.closeButtonHandler = (e: Event) => {
            console.log('[MapView] Close button clicked for station:', this.stationId);
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('closeOverlay', { 
              detail: { stationId: this.stationId } 
            }));
          };
          closeButton.addEventListener('click', this.closeButtonHandler);
        }
      }
    }

    setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral): void {
      this.position = position instanceof google.maps.LatLng ? position : new google.maps.LatLng(position.lat, position.lng);
      this.draw();
    }

    show(): void {
      this.visible = true;
      this.content.style.display = 'block';
    }

    hide(): void {
      this.visible = false;
      this.content.style.display = 'none';
    }

    destroy(): void {
      this.setMap(null);
    }

    getDiv(): HTMLDivElement {
      return this.content;
    }
  };
}