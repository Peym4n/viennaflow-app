import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { servePreview } from './static-preview.js';

let root: string;
afterEach(async () => {
  if (!root) return;
  const target = path.resolve(root);
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('viennaflow-preview-')) {
    throw new Error('Unexpected preview test directory');
  }
  await rm(target, { recursive: true, force: true });
});

describe('Production preview static routing', () => {
  it('keeps Vercel SPA fallback for page routes, excluding APIs and asset requests', async () => {
    const configuration = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      cleanUrls?: boolean;
      rewrites: { source: string; destination: string }[];
    };
    const fallback = configuration.rewrites.find(route => /^\/index(?:\.html)?$/.test(route.destination));
    expect(fallback).toBeDefined();
    expect(fallback!.destination).toBe(configuration.cleanUrls ? '/index' : '/index.html');
    // This fallback uses a plain regular expression, with no named path parameters.
    const matchesPage = new RegExp(`^${fallback!.source}$`);
    for (const page of ['/', '/about', '/auth/login', '/auth/reset-password']) {
      expect(matchesPage.test(page), page).toBe(true);
    }
    for (const resource of ['/api', '/api/getLineStops', '/api/routes/monitor', '/assets', '/assets/missing.js',
      '/_next/missing.js', '/missing.js', '/icons/missing.png', '/site.webmanifest', '/ngsw.json', '/favicon.ico']) {
      expect(matchesPage.test(resource), resource).toBe(false);
    }
  });

  it('serves manifest JSON, preserves SPA deep links, and rejects missing assets and traversal', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'viennaflow-preview-'));
    await writeFile(path.join(root, 'index.html'), '<app-root></app-root>');
    await writeFile(path.join(root, 'site.webmanifest'), '{"name":"ViennaFlow"}');
    const response = { writeHead: vi.fn(), end: vi.fn() };
    const serve = (url: string) => servePreview(url, 'GET', response as unknown as ServerResponse, root);
    await serve('/site.webmanifest');
    expect(response.writeHead.mock.calls.at(-1)![1]['Content-Type']).toBe('application/manifest+json');
    await serve('/about');
    expect(response.end.mock.calls.at(-1)![0].toString()).toContain('app-root');
    await serve('/missing.js');
    expect(response.writeHead).toHaveBeenLastCalledWith(404);
    await serve('/%2e%2e/outside');
    expect(response.writeHead).toHaveBeenLastCalledWith(404);
  });
});
