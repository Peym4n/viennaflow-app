import { createHmac, timingSafeEqual } from 'node:crypto';
import { LatLng, WalkingMatrix, WalkingPayload } from '../types/api-models.js';

function coordinate(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return typeof point['lat'] === 'number' && Number.isFinite(point['lat']) && Math.abs(point['lat']) <= 90 &&
    typeof point['lng'] === 'number' && Number.isFinite(point['lng']) && Math.abs(point['lng']) <= 180;
}

export function validateWalkingPayload(value: unknown): value is WalkingPayload {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body['origins']) && body['origins'].length === 1 && body['origins'].every(coordinate) &&
    Array.isArray(body['destinations']) && body['destinations'].length > 0 && body['destinations'].length <= 25 && body['destinations'].every(coordinate);
}

export function verifySignature(key: string, body: WalkingPayload, timestamp: string, signature: string, now = Date.now()): boolean {
  if (!/^\d{10,11}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', key).update(timestamp + '.' + JSON.stringify(body)).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** A failed route stays a failed element instead of invalidating successful siblings. */
export function normalizeWalkingResponse(value: unknown, expected: number): WalkingMatrix {
  if (!value || typeof value !== 'object') throw new Error('Invalid walking response');
  const body = value as Record<string, unknown>;
  if (body['status'] !== 'OK' || !Array.isArray(body['rows']) || body['rows'].length !== 1) throw new Error('Walking provider unavailable');
  const row = body['rows'][0] as Record<string, unknown>;
  if (!Array.isArray(row?.['elements']) || row['elements'].length !== expected) throw new Error('Invalid walking elements');
  const elements = row['elements'].map((value: unknown) => {
    if (!value || typeof value !== 'object') return { status: 'UNKNOWN_ERROR' };
    const element = value as Record<string, unknown>;
    const status = typeof element['status'] === 'string' ? element['status'] : 'UNKNOWN_ERROR';
    const duration = element['duration'] as Record<string, unknown> | undefined;
    if (status !== 'OK') return { status };
    return typeof duration?.['value'] === 'number' && Number.isFinite(duration['value']) && duration['value'] >= 0 ?
      { status, duration: { value: duration['value'] } } : { status: 'UNKNOWN_ERROR' };
  });
  return { status: 'OK', rows: [{ elements }] };
}

export async function fetchWalkingMatrix(payload: WalkingPayload, apiKey: string): Promise<WalkingMatrix> {
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.search = new URLSearchParams({
    origins: payload.origins.map(point => `${point.lat},${point.lng}`).join('|'),
    destinations: payload.destinations.map(point => `${point.lat},${point.lng}`).join('|'),
    mode: 'walking', units: 'metric', key: apiKey,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Walking provider unavailable');
  return normalizeWalkingResponse(await response.json(), payload.destinations.length);
}
