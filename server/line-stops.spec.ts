import { describe, expect, it, vi } from 'vitest';
import handler from '../api/getLineStops.js';

function request(query: Record<string, string> = {}) {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  handler({ method: 'GET', query } as unknown as Parameters<typeof handler>[0], response as unknown as Parameters<typeof handler>[1]);
  expect(response.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
  return JSON.parse(response.end.mock.calls[0][0]);
}

describe('transit catalog endpoint', () => {
  it('serves the five supported metro lines and station identities', () => {
    const catalog = request();
    expect(Object.values(catalog.lines).map((line: any) => line.bezeichnung).sort()).toEqual(['U1', 'U2', 'U3', 'U4', 'U6']);
    for (const line of Object.values(catalog.lines) as any[]) {
      expect(line.stops.features.length).toBeGreaterThan(0);
      for (const stop of line.stops.features) {
        expect(stop.properties.haltestellen_id).toBeGreaterThan(0);
        expect(stop.properties.diva).toBeGreaterThan(0);
        expect(stop.geometry.coordinates.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('filters line IDs without altering the selected line data', () => {
    const catalog = request();
    const id = Object.keys(catalog.lines)[0];
    expect(request({ linien_id: id }).lines).toEqual({ [id]: catalog.lines[id] });
    expect(request({ linien_id: '999999' }).lines).toEqual({});
  });
});
