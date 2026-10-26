import { describe, expect, it } from 'vitest';
import { normalizeNearbyPlatforms } from './nearby-platforms.js';
import { numericQuery } from './http.js';
import { parsePoint, parseWkbPoint } from './geometry.js';

describe('nearby and geometry boundaries', () => {
  it('rejects ambiguous, partial and out-of-range query values', () => {
    expect(numericQuery('48.2', -90, 90)).toBe(48.2);
    expect(numericQuery('48.2oops', -90, 90)).toBeUndefined();
    expect(numericQuery(['48.2', '49'], -90, 90)).toBeUndefined();
    expect(numericQuery('91', -90, 90)).toBeUndefined();
    expect(numericQuery('', -90, 90)).toBeUndefined();
  });

  it('skips corrupt geometry instead of inventing a station at zero coordinates', () => {
    const valid = { steig_id: 1, fk_haltestellen_id: 2, fk_linien_id: '301', haltestellen_diva: '60201394', haltestellen_name: 'Station', location: JSON.stringify({ type: 'Point', coordinates: [16.3, 48.2] }) };
    const result = normalizeNearbyPlatforms([valid, { ...valid, steig_id: 2, location: 'broken' }, { ...valid, fk_linien_id: 999 }], new Set([301]));
    expect(result).toHaveLength(1);
    expect(result[0].location.coordinates).toEqual([16.3, 48.2]);
    expect(result[0].haltestellen_diva).toBe(60201394);
    expect(result[0].fk_linien_id).toBe(301);
    expect(parsePoint({ type: 'Point', coordinates: [Infinity, 48.2] })).toBeNull();
    expect(() => parseWkbPoint('not-hex')).toThrow();
  });
});
