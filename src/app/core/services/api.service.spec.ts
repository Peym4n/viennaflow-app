// Import Vitest testing utilities
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to skip Angular testing framework for now due to compatibility issues
// and use a more direct approach with mocks

import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';

import { ApiService } from './api.service';

describe('ApiService', () => {
  // Set up variables
  let service: ApiService;
  let httpMock: any;

  beforeEach(() => {
    // Create a simple mock for HttpClient with a get method that returns an Observable
    httpMock = {
      get: vi.fn().mockReturnValue(of({ lines: {} }))
    };
    
    // Create the service with our mock
    service = new ApiService(httpMock as HttpClient);
  });

  it('should be created', () => {
    expect(service).toBeDefined();
  });

  // Basic test for API call
  it('should call get method when getMetroLineStops is called', () => {
    // Call the service method
    service.getMetroLineStops();
    
    // Verify the mock was called
    expect(httpMock.get).toHaveBeenCalled();
  });
});
