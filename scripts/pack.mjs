// Packs the built plugin for a release: dist/<name>-<version>.tgz, as PLUGINS.md ("Releasing") says.
//
//   node scripts/pack.mjs            pack what is built (npm run pack builds first)
//   node scripts/pack.mjs --tag v0.1.0   also check that the release tag is the version
//
// The archive holds plugin.json, mcp/dist/server.js, the built UI the server reads, skills/, README.md
// and LICENSE at its root: no links, no absolute paths, no `..`, no node_modules, no dot files. It is
// written here (ustar + gzip), not by `tar`, so it is the same bytes on every machine for the same files.
// Prints the path and the sha256 (the marketplace entry and the release notes carry it).
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(root, rel));
const fail = (msg) => { console.error(`pack: ${msg}`); process.exit(1); };

// ---- versions: the tag, package.json and plugin.json are one ----
const manifest = JSON.parse(read('plugin.json'));
const pkg = JSON.parse(read('package.json'));
const tagAt = process.argv.indexOf('--tag');
const tag = tagAt > 0 ? process.argv[tagAt + 1] : '';
if (!/^[a-z0-9-]{2,40}$/.test(manifest.name)) fail(`plugin.json name "${manifest.name}" is not [a-z0-9-]{2,40}`);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) fail(`plugin.json version "${manifest.version}" is not semver`);
if (pkg.version !== manifest.version) fail(`package.json version ${pkg.version} != plugin.json version ${manifest.version}`);
if (pkg.name !== manifest.name) fail(`package.json name ${pkg.name} != plugin.json name ${manifest.name}`);
if (tagAt > 0 && tag !== `v${manifest.version}`) fail(`tag "${tag}" is not v${manifest.version}`);

// ---- what goes in: the manifest's own files, nothing else ----
const files = new Set(['plugin.json', 'README.md', 'LICENSE', 'mcp/dist/server.js', 'ui/dist/app.html']);
const entry = manifest.server?.args?.[0];
if (entry && entry !== 'mcp/dist/server.js') fail(`plugin.json runs ${entry}, but the pack holds mcp/dist/server.js`);
const walk = (dir) => {
  for (const name of readdirSync(path.join(root, dir)).sort()) {
    if (name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    const st = lstatSync(path.join(root, rel));
    if (st.isSymbolicLink()) fail(`${rel} is a link`);
    if (st.isDirectory()) walk(rel);
    else if (st.isFile()) files.add(rel);
  }
};
if (manifest.skills) walk(manifest.skills.replace(/\/$/, ''));

const list = [...files].sort();
for (const rel of list) {
  const abs = path.join(root, rel);
  let st;
  try { st = lstatSync(abs); } catch { fail(`${rel} is missing${rel.startsWith('mcp/') || rel.startsWith('ui/') ? ' (run npm run build)' : ''}`); }
  if (!st.isFile()) fail(`${rel} is not a regular file`);
  if (rel.split('/').some((s) => s === '..' || s === '' || s.startsWith('.') || s === 'node_modules') || path.isAbsolute(rel)) fail(`${rel} may not be in the archive`);
  if (Buffer.byteLength(rel) > 99) fail(`${rel} is too long for the archive format`);
}
// Self-contained: the only imports left at the top of the server are node's own modules.
const outside = read('mcp/dist/server.js').toString('utf8').split('\n')
  .filter((l) => /^import\b/.test(l) && !/['"]node:[a-z/_]+['"]/.test(l));
if (outside.length) fail(`mcp/dist/server.js imports ${outside[0].trim()}: it must be self-contained (npm run build:mcp)`);

// ---- the archive: ustar, fixed owner, time and modes ----
const field = (s, n) => { const b = Buffer.alloc(n); b.write(s, 0, 'utf8'); return b; };
const octal = (v, n) => field(v.toString(8).padStart(n - 1, '0'), n);
function header(name, size) {
  const h = Buffer.alloc(512);
  field(name, 100).copy(h, 0);
  octal(0o644, 8).copy(h, 100);
  octal(0, 8).copy(h, 108);
  octal(0, 8).copy(h, 116);
  octal(size, 12).copy(h, 124);
  octal(0, 12).copy(h, 136);
  h.fill(0x20, 148, 156); // the checksum counts itself as spaces
  h[156] = 0x30; // a regular file
  field('ustar', 6).copy(h, 257);
  field('00', 2).copy(h, 263);
  const sum = h.reduce((a, b) => a + b, 0);
  field(sum.toString(8).padStart(6, '0'), 7).copy(h, 148);
  h[155] = 0x20;
  return h;
}
const blocks = [];
for (const rel of list) {
  const data = read(rel);
  blocks.push(header(rel, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
}
blocks.push(Buffer.alloc(1024));
const tgz = gzipSync(Buffer.concat(blocks), { level: 9 });
// gzip's header holds a time and an OS byte: fix them so equal files give equal bytes.
tgz.writeUInt32LE(0, 4);
tgz[9] = 3;

const out = path.join(root, 'dist', `${manifest.name}-${manifest.version}.tgz`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, tgz);
const sha = createHash('sha256').update(tgz).digest('hex');
console.log(`${path.relative(root, out)}  ${tgz.length} bytes, ${list.length} files`);
console.log(`sha256 ${sha}`);
