/** Shared scheduling bounds; browser request timing never bypasses the provider gate. */
export const DEPARTURE_REFRESH_MS = 15000;
export const DEPARTURE_MAX_AGE_MS = 120000;
export const DEPARTURE_MIN_RETRY_MS = 1000;
export const DEPARTURE_MAX_RETRY_MS = 60000;
export const DEPARTURE_REQUEST_TIMEOUT_MS = 20000;

export function departureDelay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= DEPARTURE_MAX_RETRY_MS
    ? value : undefined;
}
