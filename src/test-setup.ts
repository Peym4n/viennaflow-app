/**
 * Minimal test setup for Angular 19 + Vitest
 */
import { vi } from 'vitest';

// Load Angular test dependencies
import '@angular/compiler';
import 'zone.js';

// This file bypasses zone.js/testing to avoid ProxyZone issues
// Tests will use direct mocking instead of Angular TestBed

// Mock browser APIs often needed in tests
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock fetch to handle component resources
const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Return empty content for template and style files
  if (typeof input === 'string' && (input.endsWith('.html') || input.endsWith('.css'))) {
    return Promise.resolve(new Response('', { status: 200 }));
  }
  return originalFetch(input, init);
} as typeof window.fetch;
