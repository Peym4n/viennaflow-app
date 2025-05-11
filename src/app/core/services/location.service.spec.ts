import { describe, it, expect, beforeEach } from 'vitest';

import { LocationService } from './location.service';

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    // Create service directly since it has no dependencies
    service = new LocationService();
  });

  it('should be created', () => {
    expect(service).toBeDefined();
  });
});
