import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Writes the list of built files into dist/sw.js (replacing `self.__PRECACHE__`) so the service
 * worker can save the whole app on first visit. The list changes every build, which also makes
 * sw.js change, which is how browsers notice a new version.
 */
function precacheServiceWorker(): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  return {
    name: 'readx-precache-sw',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    generateBundle(_, bundle) {
      files = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map'));
    },
    closeBundle() {
      const sw = join(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const list = [...files, 'icon.svg', 'apple-touch-icon.png'].sort();
      const version = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('self.__PRECACHE__', JSON.stringify({ version, files: list })));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheServiceWorker()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
