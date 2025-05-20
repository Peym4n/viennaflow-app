import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private currentLocationSubject = new ReplaySubject<Coordinates>(1); // ReplaySubject to provide last known location to new subscribers
  public currentLocation$: Observable<Coordinates> = this.currentLocationSubject.asObservable();

  constructor() {
    this.trackUserLocation();
  }

  private trackUserLocation(): void {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position: GeolocationPosition) => {
          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          console.log('Location updated:', coords);
          this.currentLocationSubject.next(coords);
        },
        (error: GeolocationPositionError) => {
          console.error('Error getting location:', error);
          this.currentLocationSubject.error(error); // Propagate error to subscribers
        },
        {
          enableHighAccuracy: true,
          timeout: 10000, // Time (in milliseconds) until an error is triggered if no position is obtained
          maximumAge: 0 // Force live Caching (0 means no caching)
        }
      );
    } else {
      const errorMsg = 'Geolocation is not supported by this browser.';
      console.error(errorMsg);
      this.currentLocationSubject.error(new Error(errorMsg));
    }
  }

  // Optional: A one-time fetch for current location if needed elsewhere
  getCurrentLocationOnce(): Observable<Coordinates> {
    return new Observable<Coordinates>(observer => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position: GeolocationPosition) => {
            const coords: Coordinates = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            };
            observer.next(coords);
            observer.complete();
          },
          (error: GeolocationPositionError) => {
            observer.error(error);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      } else {
        observer.error(new Error('Geolocation is not supported by this browser.'));
      }
    }).pipe(
      catchError(err => {
        console.error('Error getting location once:', err);
        return throwError(() => err);
      })
    );
  }
}
