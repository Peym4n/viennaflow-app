/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { angularJit } from './testing/angular-jit.ts';

export default defineConfig({
  plugins: [angularJit()],
  resolve: {
    alias: [
      { find: /^(?:.*\/)?environments\/environment$/, replacement: resolve(import.meta.dirname, 'testing/environment.ts') },
      { find: '@environments/environment', replacement: resolve(import.meta.dirname, 'testing/environment.ts') },
      { find: '@app', replacement: resolve(import.meta.dirname, 'src/app') },
      { find: '@shared-types', replacement: resolve(import.meta.dirname, 'types') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
