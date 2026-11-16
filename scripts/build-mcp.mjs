// Bundles the MCP server to mcp/dist/server.js: plain Node, no tsx and no node_modules at runtime.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['mcp/server.ts'],
  outfile: 'mcp/dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
