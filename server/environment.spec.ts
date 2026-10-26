import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from '@dotenvx/dotenvx';
import { browserEnvironment, environmentFile, environmentMode, managedValue, serializeBrowserEnvironment } from '../scripts/environment.js';

vi.mock('@dotenvx/dotenvx', () => ({ get: vi.fn(() => 'file-value') }));
const values: Record<string, string> = { GOOGLE_MAPS_API_KEY: 'browser-key', GOOGLE_MAPS_MAP_ID: 'map-id',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'publishable-key', REDIS_TOKEN: 'server-secret' };
afterEach(() => vi.unstubAllEnvs());

describe('Environment configuration', () => {
  it('selects one explicit environment and maps Vercel previews to staging', () => {
    expect(environmentMode({})).toBe('development');
    expect(environmentMode({ VERCEL_ENV: 'preview' })).toBe('staging');
    expect(environmentMode({ VERCEL_ENV: 'production' })).toBe('production');
    expect(environmentMode({ VERCEL_ENV: 'production', VIENNAFLOW_ENV: 'development' })).toBe('development');
    expect(() => environmentMode({ VIENNAFLOW_ENV: 'unknown' })).toThrow('VIENNAFLOW_ENV');
    expect(environmentFile('staging')).toMatch(/\.env\.staging$/);
  });

  it('prefers platform values and reads only the chosen managed file', () => {
    vi.stubEnv('VIENNAFLOW_ENV', 'staging');
    vi.stubEnv('CONFIG_TEST_VALUE', 'platform-value');
    expect(managedValue('CONFIG_TEST_VALUE')).toBe('platform-value');
    expect(managedValue('UNSET_CONFIG_TEST_VALUE')).toBe('file-value');
    expect(get).toHaveBeenCalledWith('UNSET_CONFIG_TEST_VALUE', { path: environmentFile('staging'), strict: true });
  });

  it('serializes browser values safely and excludes server-only configuration', () => {
    const special = "key'\\with\nnewlines";
    const configuration = browserEnvironment(name => name === 'GOOGLE_MAPS_API_KEY' ? special : values[name], 'staging');
    const source = serializeBrowserEnvironment(configuration);
    const context: { result?: ReturnType<typeof browserEnvironment> } = {};
    runInNewContext(source.replace('export const environment', 'globalThis.result'), context);
    expect(context.result?.googleMaps.apiKey).toBe(special);
    expect(context.result?.environment).toBe('staging');
    expect(context.result?.production).toBe(false);
    expect(source).not.toContain('server-secret');
  });

  it('rejects missing configuration, unsafe URLs, and server Supabase keys', () => {
    expect(() => browserEnvironment(() => undefined)).toThrow('GOOGLE_MAPS_API_KEY');
    expect(() => browserEnvironment(name => name === 'SUPABASE_URL' ? 'http://remote.example' : values[name])).toThrow('SUPABASE_URL');
    for (const secret of ['sb_secret_test', `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`]) {
      expect(() => browserEnvironment(name => name === 'SUPABASE_ANON_KEY' ? secret : values[name])).toThrow('browser-safe');
    }
  });
});
