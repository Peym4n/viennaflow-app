import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';

import { NavbarComponent } from './navbar.component';

// Create mock services
const mockBreakpointObserver = {
  observe: vi.fn(() => of({ matches: false })),
};

const mockRouter = {
  navigate: vi.fn(),
};

// Mock the inject function for the component
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual('@angular/core');
  return {
    ...(actual as any),
    inject: vi.fn((token) => {
      // Return mock services based on the requested token
      if (token === BreakpointObserver) {
        return mockBreakpointObserver;
      } 
      if (token === Router) {
        return mockRouter;
      }
      // Return undefined for any other tokens
      return undefined;
    })
  };
});

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  // Create mock services
  const mockBreakpointObserver = {
    observe: vi.fn(() => of({ matches: false })),
  };
  
  const mockRouter = {
    navigate: vi.fn(),
  };

  beforeEach(() => {
    // Create component directly
    component = new NavbarComponent();
  });

  it('should create', () => {
    expect(component).toBeDefined();
  });
  
  it('should have isHandset$ observable', () => {
    expect(component.isHandset$).toBeDefined();
  });
});
