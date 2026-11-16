// The MCP App: the whole UI in one HTML file (ui/dist/app.html), which the MCP server serves as
// ui://zenwrite/app. A host's iframe may not load anything else.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { katexWoff2Only } from './vite-katex.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: import.meta.dirname,
  define: { __VERSION__: JSON.stringify(version) },
  plugins: [katexWoff2Only(), svelte(), viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'app.html' } },
});
