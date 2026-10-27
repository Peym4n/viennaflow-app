import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

type MapLayer = 'metroLines' | 'stations';

/** Optional browser preferences; blocked storage must not prevent using the map. */
@Injectable({ providedIn: 'root' })
export class MapDisplayPreferences {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  isVisible(layer: MapLayer): boolean {
    if (!this.browser) return true;
    try {
      // Both layers default to visible when the saved value is absent or invalid.
      return window.localStorage.getItem(`viennaflow.map.${layer}`) !== 'false';
    } catch {
      return true;
    }
  }

  setVisible(layer: MapLayer, visible: boolean): void {
    if (!this.browser) return;
    try {
      window.localStorage.setItem(`viennaflow.map.${layer}`, String(visible));
    } catch {
      // Keep the current UI usable when storage is unavailable or full.
    }
  }
}
