import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { of } from 'rxjs';
import { GoogleMapsService } from './google-maps.service';

describe('GoogleMapsService', () => {
  let service: GoogleMapsService;
  let originalEnvironment: any;
  
  beforeEach(() => {
    // Store the original environment if it exists
    if (typeof (global as any).environment !== 'undefined') {
      originalEnvironment = (global as any).environment;
    }
    
    // Mock environment object with the API key
    vi.stubGlobal('environment', { googleMaps: { apiKey: 'mock-api-key' } });
    
    // Create service instance directly
    service = new GoogleMapsService();
    
    // Replace the private API_KEY field for testing
    Object.defineProperty(service, 'API_KEY', { value: 'mock-api-key' });
    
    // Mock document.createElement method
    const mockScript = {
      setAttribute: vi.fn(),
      onload: null,
      onerror: null
    };
    
    vi.spyOn(document, 'createElement').mockImplementation(() => mockScript as any);
    
    // Mock appendChild method of document.head
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => document.createElement('script') as Node);
  });
  
  afterEach(() => {
    // Restore mocks
    vi.restoreAllMocks();
    
    // Restore the original environment
    if (originalEnvironment) {
      (global as any).environment = originalEnvironment;
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('should be created', () => {
    expect(service).toBeDefined();
  });
  
  it('should attempt to load Google Maps API when requested', () => {
    const appendChildSpy = vi.spyOn(document.head, 'appendChild');
    service.loadGoogleMapsApi();
    expect(appendChildSpy).toHaveBeenCalled();
  });
});
