import { Monitor } from '../types/api-models.js';
import { normalizeMonitorResponse } from '../shared/monitor-response.js';

export async function fetchDepartures(ids: string[]): Promise<Monitor[]> {
  const url = new URL('https://www.wienerlinien.at/ogd_realtime/monitor');
  ids.forEach(id => url.searchParams.append('diva', id));
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Departure provider unavailable');
  const body: unknown = await response.json();
  if (body && typeof body === 'object' && 'message' in body) {
    const message = body.message;
    if (message && typeof message === 'object' && 'messageCode' in message && message.messageCode !== 1) {
      throw new Error('Departure provider rejected request');
    }
  }
  return normalizeMonitorResponse(body).data!.monitors;
}
