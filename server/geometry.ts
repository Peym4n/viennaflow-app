import wkx from 'wkx';
import { GeoJsonPoint } from '../types/api-models.js';

export function parsePoint(value: unknown): GeoJsonPoint | null {
  let point: unknown = value;
  if (typeof point === 'string') {
    try { point = JSON.parse(point); } catch { return null; }
  }
  if (!point || typeof point !== 'object') return null;
  const shape = point as Record<string, unknown>;
  const coordinates = shape['coordinates'];
  if (shape['type'] !== 'Point' || !Array.isArray(coordinates) || coordinates.length !== 2 ||
      !coordinates.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
      Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return null;
  return { type: 'Point', coordinates: [coordinates[0], coordinates[1]] };
}

export function parseWkbPoint(value: unknown): GeoJsonPoint {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('Invalid station geometry');
  const point = parsePoint(wkx.Geometry.parse(Buffer.from(value, 'hex')).toGeoJSON());
  if (!point) throw new Error('Invalid station point');
  return point;
}
