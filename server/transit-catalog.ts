import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTransitCatalog } from '../shared/transit-catalog.js';
import { LineStopsResponse } from '../types/api-models.js';

let allowedDivas: Set<string> | undefined;
let catalog: LineStopsResponse | undefined;
export function getCatalog(): LineStopsResponse {
  if (!catalog) catalog = normalizeTransitCatalog(JSON.parse(readFileSync(join(process.cwd(), 'api/lineStops.json'), 'utf8')));
  return catalog!;
}
export function getAllowedLineIds(): ReadonlySet<number> { return new Set(Object.keys(getCatalog().lines).map(Number)); }
export function getAllowedDivas(): ReadonlySet<string> {
  if (!allowedDivas) {
    const catalog = getCatalog();
    allowedDivas = new Set(Object.values(catalog.lines).flatMap(line => line.stops.features.map(stop => String(stop.properties.diva))));
  }
  return allowedDivas;
}
