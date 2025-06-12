import { Injectable, OnDestroy } from '@angular/core';
import { Observable, ReplaySubject, throwError, interval, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocationService implements OnDestroy {
  private currentLocationSubject = new ReplaySubject<Coordinates>(1); // ReplaySubject to provide last known location to new subscribers
  public currentLocation$: Observable<Coordinates> = this.currentLocationSubject.asObservable();
  
  // Add a subject to explicitly track location availability
  private locationAvailableSubject = new ReplaySubject<boolean>(1);
  public locationAvailable$ = this.locationAvailableSubject.asObservable();
  
  private locationWatchId: number | null = null;
  private retrySubscription: Subscription | null = null;
  private lastKnownCoords: Coordinates | null = null;
  private readonly RETRY_INTERVAL_MS = 5000; // Check every 5 seconds

  constructor() {
    this.trackUserLocation();
  }

  private trackUserLocation(): void {
    if (navigator.geolocation) {
      this.startLocationWatch();
    } else {
      const errorMsg = 'Geolocation is not supported by this browser.';
      console.error(errorMsg);
      this.currentLocationSubject.error(new Error(errorMsg));
    }
  }
  
  private startLocationWatch(): void {
    // Clear any existing watch
    this.clearLocationWatch();
    
    // Start a new watch
    this.locationWatchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => {
        const coords: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        };
        console.log('Location updated:', coords);
        this.lastKnownCoords = coords;
        this.currentLocationSubject.next(coords);
        
        // Signal that location is available
        this.locationAvailableSubject.next(true);
        
        // We have a valid location, so stop any retry attempts
        this.stopRetryAttempts();
      },
      (error: GeolocationPositionError) => {
        console.error('Error getting location:', error);
        
        // Signal that location is not available
        this.locationAvailableSubject.next(false);
        
        // Don't propagate the error to subscribers if we have a last known location
        // Instead, start retry attempts
        if (this.lastKnownCoords) {
          console.log('Using last known location while starting retry attempts');
          this.startRetryAttempts();
        } else {
          // Do not propagate a recoverable error, as it would terminate the stream.
          // The `locationAvailable$` subject handles the error state in the UI.
          // The retry mechanism will attempt to get a location later.
          console.warn('[LocationService] No last known location and an error occurred. Starting retry attempts.');
          this.startRetryAttempts();
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000, // Time (in milliseconds) until an error is triggered if no position is obtained
        maximumAge: 0 // Force live Caching (0 means no caching)
      }
    );
  }
  
  private clearLocationWatch(): void {
    if (this.locationWatchId !== null) {
      navigator.geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = null;
    }
  }
  
  private startRetryAttempts(): void {
    // Stop any existing retry attempts
    this.stopRetryAttempts();
    
    console.log('Starting location retry attempts every', this.RETRY_INTERVAL_MS, 'ms');
    
    // Start new retry interval
    this.retrySubscription = interval(this.RETRY_INTERVAL_MS).subscribe(() => {
      console.log('Retrying to get location...');
      this.getCurrentPositionOnce();
    });
  }
  
  private stopRetryAttempts(): void {
    if (this.retrySubscription) {
      this.retrySubscription.unsubscribe();
      this.retrySubscription = null;
    }
  }
  
  private getCurrentPositionOnce(): void {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp
          };
          console.log('Location retry successful:', coords);
          this.lastKnownCoords = coords;
          this.currentLocationSubject.next(coords);
          
          // Signal that location is available
          this.locationAvailableSubject.next(true);
          
          // Stop retry attempts since we have a successful location
          this.stopRetryAttempts();
          
          // Restart the watch with the new position
          this.startLocationWatch();
        },
        (error: GeolocationPositionError) => {
          console.log('Location retry failed:', error.message);
          // Keep retrying, don't propagate error to subscribers
        },
        {
          enableHighAccuracy: true,
          timeout: 5000, // Shorter timeout for retry attempts
          maximumAge: 0
        }
      );
    }
  }

  // Clean up subscriptions when service is destroyed
  ngOnDestroy(): void {
    this.clearLocationWatch();
    this.stopRetryAttempts();
  }
  
  // Public method to manually retry getting location
  public retryLocationAccess(): void {
    this.startLocationWatch();
  }
  
  // Get the last known coordinates (used when recovering from location errors)
  public getLastKnownCoordinates(): Coordinates | null {
    return this.lastKnownCoords;
  }
  getCurrentLocationOnce(): Observable<Coordinates> {
    return new Observable<Coordinates>(observer => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position: GeolocationPosition) => {
            const coords: Coordinates = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp
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
