import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { environment } from '../../../environments/environment';

declare global {
  interface Window {
    initMap?: () => void;
    google: typeof google;
  }
}

@Injectable({ providedIn: 'root' })
export class GoogleMapsService {
  private loading: Promise<void> | null = null;

  isGoogleMapsLoaded(): boolean { return !!window.google?.maps?.geometry; }

  loadGoogleMapsApi(): Observable<void> {
    if (this.isGoogleMapsLoaded()) return of(undefined);
    if (!this.loading) this.loading = this.load().catch(error => {
      this.loading = null;
      throw error;
    });
    return from(this.loading);
  }

  private load(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!environment.googleMaps.apiKey) return reject(new Error('Maps configuration is unavailable'));
      const script = document.createElement('script');
      const finish = (error?: Error) => {
        clearTimeout(deadline);
        script.onerror = null;
        if (window.initMap === loaded) delete window.initMap;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const loaded = () => finish(this.isGoogleMapsLoaded() ? undefined : new Error('Maps geometry did not load'));
      const deadline = setTimeout(() => finish(new Error('Maps loading timed out')), 30000);
      window.initMap = loaded;
      script.id = 'google-maps-script';
      script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
        key: environment.googleMaps.apiKey, callback: 'initMap', v: 'weekly', libraries: 'geometry', loading: 'async',
      });
      script.async = true;
      script.onerror = () => finish(new Error('Could not load Maps'));
      document.head.appendChild(script);
    });
  }
}
