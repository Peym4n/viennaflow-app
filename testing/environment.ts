// Deliberately nonsecret configuration: unit tests never call these services.
export const environment = {
  production: false,
  supabase: { url: 'https://example.supabase.co', anonKey: 'test-only' },
  googleMaps: { apiKey: 'test-only', mapId: 'test-map' },
};
