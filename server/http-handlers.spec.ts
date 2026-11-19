import { createHmac } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supabaseKeepalive from '../api/cron/supabase-keepalive.js';
import nearby from '../api/getNearbySteige.js';
import walking from '../api/routes/walking-matrix.js';
import session from '../api/session/init.js';
import monitor from '../api/routes/monitor.js';

const mocks = vi.hoisted(() => ({ mget: vi.fn(), get: vi.fn(), set: vi.fn(), ttl: vi.fn(), usage: vi.fn(), fetch: vi.fn(), departures: vi.fn(),
  eval: vi.fn(), pipeline: vi.fn() }));
vi.mock('./redis.js', () => ({ getRedis: () => mocks }));
vi.mock('@dotenvx/dotenvx', () => ({ getSync: () => 'test-only' }));
vi.mock('./walking-limits.js', () => ({ reserveWalkingUsage: mocks.usage }));
vi.mock('./departure-provider.js', () => ({ fetchDepartures: mocks.departures }));
vi.mock('./walking.js', async importOriginal => ({ ...await importOriginal<typeof import('./walking.js')>(), fetchWalkingMatrix: mocks.fetch }));

async function invoke(handler: typeof walking, request: object) {
  const result = { status: 0, headers: new Map<string, unknown>(), body: null as unknown };
  const response = {
    setHeader: (key: string, value: unknown) => result.headers.set(key, value),
    status: (code: number) => { result.status = code; return response; },
    json: (body: unknown) => { result.body = body; },
  };
  await handler(request as VercelRequest, response as unknown as VercelResponse);
  return result;
}

describe('walking HTTP contracts', () => {
  const body = { origins: [{ lat: 48.2, lng: 16.3 }], destinations: [{ lat: 48.21, lng: 16.31 }] };
  const key = 'test-signing-key';
  function signed() {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { method: 'POST', body, cookies: { sessionId: 'a'.repeat(64) }, headers: {
      'x-timestamp': timestamp,
      'x-signature': createHmac('sha256', key).update(timestamp + '.' + JSON.stringify(body)).digest('hex'),
    } };
  }
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.mget.mockResolvedValue([key, null]);
    mocks.usage.mockResolvedValue(0);
    mocks.fetch.mockResolvedValue({ status: 'OK', rows: [{ elements: [{ status: 'OK', duration: { value: 120 } }] }] });
  });

  it('rejects invalid destinations before session and provider work', async () => {
    expect((await invoke(walking, { ...signed(), body: { ...body, destinations: [] } })).status).toBe(400);
    expect(mocks.mget).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('requests session renewal for missing credentials', async () => {
    expect((await invoke(walking, { ...signed(), cookies: {} })).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('delivers a valid signed matrix after reserving usage', async () => {
    const result = await invoke(walking, signed());
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.usage).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(body, 'test-only');
  });

  it('returns a retryable usage limit without calling the provider', async () => {
    mocks.usage.mockResolvedValue(60);
    const result = await invoke(walking, signed());
    expect(result.status).toBe(429);
    expect(result.headers.get('Retry-After')).toBe('60');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails safely when Redis is unavailable', async () => {
    mocks.mget.mockRejectedValue(new Error('private Redis detail'));
    const result = await invoke(walking, signed());
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('private Redis detail');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('maps provider failures to a public integration error', async () => {
    mocks.fetch.mockRejectedValue(new Error('private Google detail'));
    const result = await invoke(walking, signed());
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('private Google detail');
  });

  it('returns expiry metadata and preserves signing-cookie protections', async () => {
    mocks.get.mockResolvedValue('b'.repeat(128));
    mocks.ttl.mockResolvedValue(86400);
    const result = await invoke(session, { method: 'GET', cookies: { sessionId: 'a'.repeat(64) } });
    expect(result.status).toBe(200);
    expect(result.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.body).toMatchObject({ expiresAt: expect.any(Number) });
  });

  it('rejects invalid departure IDs before touching coordination', async () => {
    const result = await invoke(monitor, { method: 'POST', body: { divaIds: ['123', 'invalid'] } });
    expect(result.status).toBe(400);
    expect(mocks.mget).not.toHaveBeenCalled();
    expect(mocks.departures).not.toHaveBeenCalled();
  });

  it('returns retryable departures when Redis is unavailable without calling the provider', async () => {
    mocks.mget.mockRejectedValue(new Error('Redis unavailable'));
    const result = await invoke(monitor, { method: 'POST', body: { divaIds: ['60201394'] } });
    expect(result.status).toBe(503);
    expect(result.headers.get('Retry-After')).toBe('15');
    expect(mocks.departures).not.toHaveBeenCalled();
  });

  it('matches Retry-After to the coordinator delay instead of always returning fifteen seconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    mocks.mget.mockResolvedValue([null]);
    const pipeline = { zadd: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => []) };
    mocks.pipeline.mockReturnValue(pipeline);
    mocks.eval.mockResolvedValue([0, 8500]);
    const result = await invoke(monitor, { method: 'POST', body: { divaIds: ['60201394'] } });
    expect(result.status).toBe(200);
    expect(result.headers.get('Retry-After')).toBe('9');
    expect(result.body).toMatchObject({ nextPollInMs: 8500,
      stations: { '60201394': { status: 'pending', retryAfterMs: 8500 } } });
    expect(mocks.departures).not.toHaveBeenCalled();
  });
});

describe('Supabase HTTP contracts', () => {
  const request = { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } };
  const fetch = vi.fn<typeof globalThis.fetch>();

  beforeEach(() => {
    fetch.mockReset();
    fetch.mockImplementation(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example');
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-only');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects unsupported methods and missing or invalid cron credentials before querying Supabase', async () => {
    const post = await invoke(supabaseKeepalive, { ...request, method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
    expect((await invoke(supabaseKeepalive, { ...request, headers: {} })).status).toBe(401);
    expect((await invoke(supabaseKeepalive, { ...request, headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    vi.stubEnv('CRON_SECRET', undefined);
    expect((await invoke(supabaseKeepalive, request)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes one bounded read of each public transit table and returns an uncacheable success', async () => {
    const result = await invoke(supabaseKeepalive, request);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(3);

    const reads = Object.fromEntries(fetch.mock.calls.map(([input, init]) => {
      const call = new Request(input, init);
      const url = new URL(call.url);
      return [url.pathname, { method: call.method, schema: call.headers.get('Accept-Profile'),
        column: url.searchParams.get('select'), limit: url.searchParams.get('limit') }];
    }));
    expect(reads).toEqual({
      '/rest/v1/linien': { method: 'GET', schema: 'api', column: 'linien_id', limit: '1' },
      '/rest/v1/haltestellen': { method: 'GET', schema: 'api', column: 'haltestellen_id', limit: '1' },
      '/rest/v1/steige': { method: 'GET', schema: 'api', column: 'steig_id', limit: '1' },
    });
  });

  it('calls the nearby function in the exposed api schema', async () => {
    const result = await invoke(nearby, { method: 'GET', query: { lat: '48.2', lon: '16.3', radius: '800' } });
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);

    const [input, init] = fetch.mock.calls[0];
    const rpc = new Request(input, init);
    expect(new URL(rpc.url).pathname).toBe('/rest/v1/rpc/get_nearby_steige');
    expect(rpc.method).toBe('POST');
    expect(rpc.headers.get('Content-Profile')).toBe('api');
    expect(await rpc.json()).toEqual({ lat: 48.2, lon: 16.3, radius: 800 });
  });

  it('reports a failed transit read without exposing provider details', async () => {
    fetch.mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : input);
      return url.pathname.endsWith('/steige')
        ? Response.json({ message: 'private provider detail' }, { status: 403 })
        : Response.json([]);
    });

    const result = await invoke(supabaseKeepalive, request);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'Supabase check temporarily unavailable' });
  });
});
