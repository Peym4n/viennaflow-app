import { Monitor, MonitorApiResponse, StationMonitorStatus } from '../types/api-models.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function normalizeDiva(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0 ? String(Number(text)) : undefined;
}

/** Validate fields consumed by the map; RBL/platform IDs are never DIVA fallbacks. */
export function normalizeMonitorResponse(value: unknown): MonitorApiResponse {
  const body = record(value);
  const data = record(body?.['data']);
  if (!Array.isArray(data?.['monitors'])) throw new Error('Invalid departure response');
  const monitors: Monitor[] = [];
  for (const item of data['monitors']) {
    const monitor = record(item);
    const location = record(monitor?.['locationStop']);
    const properties = record(location?.['properties']);
    const diva = normalizeDiva(properties?.['name']);
    if (!diva || !Array.isArray(monitor?.['lines'])) continue;
    const lines = monitor['lines'].flatMap((value: unknown) => {
      const line = record(value);
      const departures = record(line?.['departures']);
      if (typeof line?.['name'] !== 'string' || !/^U[12346]$/.test(line['name']) ||
          typeof line['towards'] !== 'string' || !Array.isArray(departures?.['departure'])) return [];
      const valid = departures['departure'].filter((departure: unknown) => {
        const time = record(record(departure)?.['departureTime']);
        return typeof time?.['countdown'] === 'number' && Number.isFinite(time['countdown']) && time['countdown'] >= 0;
      }).slice(0, 3);
      return [{ ...line, departures: { departure: valid } }];
    });
    monitors.push({ ...monitor, locationStop: { ...location, properties: { ...properties, name: diva } }, lines } as unknown as Monitor);
  }
  if (data['monitors'].length && !monitors.length) throw new Error('Invalid station monitors');
  const statuses = record(body?.['stations']);
  const stations: Record<string, StationMonitorStatus> = {};
  for (const [id, raw] of Object.entries(statuses ?? {})) {
    const status = record(raw);
    if (!normalizeDiva(id) || !['data', 'empty', 'pending', 'stale', 'error'].includes(String(status?.['status']))) continue;
    stations[id] = {
      status: status!['status'] as StationMonitorStatus['status'],
      updatedAt: typeof status!['updatedAt'] === 'number' ? status!['updatedAt'] : undefined,
      retryAfterMs: typeof status!['retryAfterMs'] === 'number' ? status!['retryAfterMs'] : undefined,
    };
  }
  return {
    data: { monitors }, message: typeof body?.['message'] === 'string' ? body['message'] : 'Departures received',
    errorOccurred: body?.['errorOccurred'] === true,
    timestamp: typeof body?.['timestamp'] === 'number' ? body['timestamp'] : Date.now(),
    stations,
  };
}
