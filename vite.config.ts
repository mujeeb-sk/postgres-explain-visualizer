/**
 * Two builds, both into out/:
 *   vite build                    the webview (the plan visualizer) -> out/webview/webview.{js,css}
 *   vite build --mode extension   the extension itself              -> out/extension.js
 * Vitest reads the same file for the unit tests.
 */
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const { version } = JSON.parse(fs.readFileSync(here('./package.json'), 'utf8')) as { version: string };

/**
 * Writes THIRD-PARTY-NOTICES.txt next to a build: the license of every npm package whose code
 * went into it. The packages are bundled, so their notices have to ship with the bundle.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle() {
      const notices = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        const match = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id.replace(/^\0/, '').split('?')[0]);
        if (!match) {
          continue;
        }
        const dir = match[1] + match[2];
        let manifest: { name: string; version: string; license?: string | { type?: string }; homepage?: string };
        try {
          manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        const key = `${manifest.name} ${manifest.version}`;
        if (notices.has(key)) {
          continue;
        }
        const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type;
        const file = fs.readdirSync(dir).find((name) => /^licen[cs]e(\.|$)/i.test(name));
        notices.set(
          key,
          [
            key,
            `License: ${license ?? 'see below'}`,
            ...(manifest.homepage ? [`Homepage: ${manifest.homepage}`] : []),
            '',
            file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '(The package has no license file.)',
          ].join('\n'),
        );
      }
      const sorted = [...notices.keys()].sort().map((key) => notices.get(key));
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.txt',
        source:
          'The code in this folder includes the npm packages below, under their own licenses.\n\n' +
          sorted.join(`\n\n${'-'.repeat(80)}\n\n`) +
          '\n',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // src/pev2 imports its own files as "@/...".
  const resolve = { alias: { '@': here('./src/pev2') } };

  if (mode === 'extension') {
    return {
      resolve,
      plugins: [thirdPartyNotices()],
      build: {
        outDir: 'out',
        emptyOutDir: false,
        target: 'node20',
        lib: { entry: 'src/extension.ts', formats: ['cjs'], fileName: () => 'extension.js' },
        rollupOptions: { external: ['vscode', /^node:/, ...builtinModules] },
      },
    };
  }

  return {
    resolve,
    plugins: [vue({ template: { compilerOptions: { whitespace: 'preserve' } } }), thirdPartyNotices()],
    // Shown next to the logo in the visualizer.
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      outDir: 'out/webview',
      emptyOutDir: true,
      cssCodeSplit: false,
      // One file on purpose; it is read from disk, not downloaded.
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        input: 'src/webview/main.ts',
        // One classic script and one stylesheet, with fixed names for the webview's HTML.
        output: { format: 'iife', entryFileNames: 'webview.js', assetFileNames: 'webview[extname]' },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.ts'],
    },
  };
});
