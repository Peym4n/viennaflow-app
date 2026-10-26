import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeTransitCatalog } from '../shared/transit-catalog.js';

const source = () => JSON.parse(readFileSync('data/transit/catalog-source.json', 'utf8'));

describe('Versioned transit catalog', () => {
  it('generates the committed catalog deterministically with distinct display and routing points', () => {
    const catalog = normalizeTransitCatalog(source());
    expect(readFileSync('api/lineStops.json', 'utf8')).toBe(JSON.stringify(catalog) + '\n');
    const stops = Object.values(catalog.lines).flatMap(line => line.stops.features);
    expect(stops).toHaveLength(109);
    expect(new Set(stops.map(stop => stop.properties.haltestellen_id)).size).toBe(98);
    expect(stops.every(stop => stop.properties.physical_location?.type === 'Point')).toBe(true);
    expect(stops.some(stop => JSON.stringify(stop.geometry) !== JSON.stringify(stop.properties.physical_location))).toBe(true);
  });

  it('rejects corrupt geometry, identifiers and conflicting station DIVAs', () => {
    const catalog = normalizeTransitCatalog(source());
    const lines = Object.values(catalog.lines);
    lines[0].stops.features[0].properties.physical_location!.coordinates = [200, 100];
    expect(() => normalizeTransitCatalog(catalog)).toThrow('Invalid transit catalog');
    const badId = normalizeTransitCatalog(source());
    Object.values(badId.lines)[0].stops.features[0].properties.diva = 0;
    expect(() => normalizeTransitCatalog(badId)).toThrow();
    const duplicate = normalizeTransitCatalog(source());
    const first = Object.values(duplicate.lines)[0].stops.features[0];
    const other = structuredClone(first);
    other.properties.diva++;
    Object.values(duplicate.lines)[0].stops.features.push(other);
    expect(() => normalizeTransitCatalog(duplicate)).toThrow();
  });
});
