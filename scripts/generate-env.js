import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserEnvironment, serializeBrowserEnvironment } from './environment.js';

try {
  const configuration = browserEnvironment();
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/environments');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'environment.ts'), serializeBrowserEnvironment(configuration));
  console.log(`Generated browser configuration for ${configuration.environment}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Browser configuration generation failed');
  process.exitCode = 1;
}
