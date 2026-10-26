import { LineStopsResponse } from '../types/api-models.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const point = (value: unknown): boolean => Array.isArray(value) && value.length === 2 &&
  value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)) &&
  Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const geometry = (value: unknown): boolean => object(value) && value['type'] === 'Point' && point(value['coordinates']);
const invalid = (): never => { throw new Error('Invalid transit catalog'); };

/** Validate fields used for station identity, routing, map rendering and line membership. */
export function normalizeTransitCatalog(value: unknown): LineStopsResponse {
  if (!object(value) || !object(value['metainfo']) || !object(value['lines'])) return invalid();
  const metadata = value['metainfo'];
  if (typeof metadata['version'] !== 'string' || typeof metadata['last_updated'] !== 'string' ||
    !Number.isFinite(Date.parse(metadata['last_updated']))) return invalid();
  const identities = new Map<number, number>();
  for (const [lineId, line] of Object.entries(value['lines'])) {
    if (!/^\d+$/.test(lineId) || !object(line) || !['U1', 'U2', 'U3', 'U4', 'U6'].includes(String(line['bezeichnung'])) ||
      typeof line['farbe'] !== 'string' || !/^#[\da-f]{6}$/i.test(line['farbe']) ||
      typeof line['echtzeit'] !== 'boolean' || typeof line['reihenfolge'] !== 'number' ||
      !object(line['stops']) || line['stops']['type'] !== 'FeatureCollection' || !Array.isArray(line['stops']['features']) ||
      !Array.isArray(line['lineStrings'])) return invalid();
    for (const segment of line['lineStrings']) {
      if (!object(segment) || segment['type'] !== 'LineString' || !Array.isArray(segment['coordinates']) ||
        segment['coordinates'].length < 2 || !segment['coordinates'].every(point)) return invalid();
    }
    for (const feature of line['stops']['features']) {
      if (!object(feature) || feature['type'] !== 'Feature' || !geometry(feature['geometry']) || !object(feature['properties'])) return invalid();
      const properties = feature['properties'];
      const stationId = properties['haltestellen_id'];
      const diva = properties['diva'];
      if (!id(stationId) || !id(diva) || typeof properties['name'] !== 'string' || !properties['name'].trim() ||
        !Array.isArray(properties['linien_ids']) || !properties['linien_ids'].every(id) ||
        (properties['physical_location'] !== undefined && !geometry(properties['physical_location']))) return invalid();
      if (identities.has(stationId) && identities.get(stationId) !== diva) return invalid();
      identities.set(stationId, diva);
    }
  }
  return value as unknown as LineStopsResponse;
}
