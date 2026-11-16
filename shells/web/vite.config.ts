// The standalone PWA: static files in shells/web/dist, installable and offline. A small plugin
// writes the service worker with the list of files the build really produced, so the first visit
// caches the whole app.
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cacheVersion } from './sw-version.ts';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { katexWoff2Only } from '../../ui/vite-katex.ts';

function walk(dir: string, rel = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
}

function serviceWorker(): Plugin {
  let out = '';
  return {
    name: 'zenwrite-sw',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    // After everything is written: the worker lists the files that really are in the build.
    closeBundle() {
      const files = walk(out).filter((f) => f !== 'sw.js').sort();
      const version = cacheVersion(files, (f) => readFileSync(join(out, f)));
      const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');
      writeFileSync(join(out, 'sw.js'), template.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)));
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [katexWoff2Only(), svelte(), serviceWorker()],
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
