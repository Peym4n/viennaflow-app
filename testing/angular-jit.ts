import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import ts from 'typescript';
import { constructorParametersDownlevelTransform } from '@angular/compiler-cli/private/tooling';

/** Compile local Angular components for Vitest, including resources and signal contracts. */
export function angularJit(): Plugin {
  let program: ts.Program | undefined;
  return {
    name: 'angular-jit',
    enforce: 'pre',
    watchChange() { program = undefined; },
    transform(source, id) {
      if (!id.replaceAll('\\', '/').includes('/src/app/') || !id.endsWith('.ts') || !/@(?:Component|Injectable|Directive|Pipe)\(/.test(source)) return;
      if (!program) {
        const config = ts.readConfigFile('tsconfig.spec.json', ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
        program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: false, sourceMap: false });
      }
      const file = program.getSourceFile(id);
      if (!file) throw new Error(`Component is absent from the test TypeScript program: ${id}`);
      let emitted = '';
      // The same version-pinned transformer the Angular CLI uses handles signal inputs and DI metadata.
      program.emit(file, (name, content) => { if (name.endsWith('.js')) emitted = content; }, undefined, false,
        { before: [constructorParametersDownlevelTransform(program)] });
      const resource = (file: string) => JSON.stringify(readFileSync(resolve(dirname(id), file), 'utf8'));
      const code = emitted
        .replace(/templateUrl:\s*['"]([^'"]+)['"]/g, (_match, file: string) => `template: ${resource(file)}`)
        .replace(/styleUrl:\s*['"]([^'"]+)['"]/g, (_match, file: string) => `styles: [${resource(file)}]`)
        .replace(/styleUrls:\s*\[([^\]]*)\]/g, (_match, files: string) =>
          `styles: [${[...files.matchAll(/['"]([^'"]+)['"]/g)].map(match => resource(match[1])).join(',')}]`);
      return { code, map: null };
    },
  };
}
