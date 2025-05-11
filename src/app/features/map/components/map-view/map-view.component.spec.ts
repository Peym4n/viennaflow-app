import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ElementRef } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { MapViewComponent } from './map-view.component';
import { GoogleMapsService } from '../../../../core/services/google-maps.service';
import { ApiService } from '../../../../core/services/api.service';

// Define service mocks globally so the inject mock can access them
const googleMapsServiceMock = {
  loadGoogleMapsApi: vi.fn().mockReturnValue(of(undefined)),
  isGoogleMapsLoaded: vi.fn().mockReturnValue(true)
};

const mockLineStopsResponse = {
  metainfo: {
    last_updated: '2025-05-08T15:30:00',
    version: '1.0'
  },
  lines: {}
};

const apiServiceMock = {
  getMetroLineStops: vi.fn().mockReturnValue(of(mockLineStopsResponse)),
  getStops: vi.fn().mockReturnValue(of([]))
};

const snackBarMock = {
  open: vi.fn()
};

// Mock Angular inject function for component's dependencies
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual('@angular/core');
  return {
    ...(actual as any),
    inject: vi.fn((token) => {
      if (token === GoogleMapsService) {
        return googleMapsServiceMock;
      } else if (token === ApiService) {
        return apiServiceMock;
      } else if (token === MatSnackBar) {
        return snackBarMock;
      }
      return undefined;
    })
  };
});

describe('MapViewComponent', () => {
  let component: MapViewComponent;

  // Helper function to silence console during tests
  const silenceConsole = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  };

  beforeEach(() => {
    // Silence console output for tests
    silenceConsole();
    
    // Reset mock implementations before each test
    vi.mocked(googleMapsServiceMock.loadGoogleMapsApi).mockReturnValue(of(undefined));
    vi.mocked(googleMapsServiceMock.isGoogleMapsLoaded).mockReturnValue(true);
    vi.mocked(apiServiceMock.getMetroLineStops).mockReturnValue(of(mockLineStopsResponse));
    vi.mocked(apiServiceMock.getStops).mockReturnValue(of([]));
    vi.mocked(snackBarMock.open).mockImplementation(vi.fn());

    // Create component directly
    component = new MapViewComponent();
    
    // Mock the map container element ref
    component.mapContainer = { nativeElement: document.createElement('div') } as ElementRef;
    
    // Mock lifecycle methods to prevent errors
    vi.spyOn(component, 'ngOnInit').mockImplementation(() => {});
    vi.spyOn(component, 'ngAfterViewInit').mockImplementation(() => {});
    vi.spyOn(component, 'ngOnDestroy').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeDefined();
  });
  
  it('should initialize with default values', () => {
    // Initialize with known default values
    expect(component.isLoading).toBe(true);
    expect(component.hasLocationError).toBe(false);
    expect(component.showMetroLines).toBe(true);
    expect(component.showStations).toBe(true);
  });
});
