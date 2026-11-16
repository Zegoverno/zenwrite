// The release archive, as zenbot will meet it: pack, check the archive's rules, unpack it into an empty
// folder (no node_modules, no source) and run the MCP smoke test against the extracted server.
// `node tests/pack-test.mjs` (npm run test:pack; it packs what is built).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(root + 'plugin.json', 'utf8'));
const out = execFileSync('node', ['scripts/pack.mjs', '--tag', `v${manifest.version}`], { cwd: root, encoding: 'utf8' });
const archive = path.join(root, 'dist', `${manifest.name}-${manifest.version}.tgz`);
const sha = /sha256 ([0-9a-f]{64})/.exec(out)?.[1];
assert.ok(sha, 'pack prints the sha256');
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), sha);

// a second pack gives the same bytes
assert.match(execFileSync('node', ['scripts/pack.mjs'], { cwd: root, encoding: 'utf8' }), new RegExp(sha), 'the archive is reproducible');
// the tag must be the version
assert.throws(() => execFileSync('node', ['scripts/pack.mjs', '--tag', 'v9.9.9'], { cwd: root, stdio: 'pipe' }), /v9\.9\.9/);

// the archive's rules: only regular files, relative names, no node_modules, no dot files
const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split('\n');
const names = listing.map((l) => l.split(/\s+/).slice(5).join(' '));
for (const [i, l] of listing.entries()) {
  assert.match(l, /^-/, `${names[i]} is a regular file`);
  assert.ok(!path.isAbsolute(names[i]) && !names[i].split('/').some((s) => s === '..' || s.startsWith('.') || s === 'node_modules'), names[i]);
}
for (const must of ['plugin.json', 'mcp/dist/server.js', 'ui/dist/app.html', 'README.md', 'LICENSE', 'skills/writing/proofread/SKILL.md']) assert.ok(names.includes(must), `${must} is in the archive`);
assert.deepEqual(names.filter((n) => !/^(plugin\.json|README\.md|LICENSE|mcp\/dist\/server\.js|ui\/dist\/app\.html|skills\/.+)$/.test(n)), [], 'nothing else is in it');

// unpack into an empty folder and run the server from there
const tmp = mkdtempSync(path.join(tmpdir(), `${manifest.name}-pack-`));
try {
  const dir = path.join(tmp, 'plugin');
  execFileSync('mkdir', [dir]);
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  assert.ok(!existsSync(path.join(dir, 'node_modules')), 'no node_modules');
  assert.ok(readdirSync(dir).every((n) => !lstatSync(path.join(dir, n)).isSymbolicLink()));
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8')), manifest);
  const smoke = execFileSync('node', [path.join(root, 'tests/mcp-smoke.mjs'), dir], { cwd: tmp, encoding: 'utf8' });
  assert.match(smoke, /mcp smoke ok/);
  console.log(`pack ok: ${path.relative(root, archive)} (${names.length} files, sha256 ${sha.slice(0, 12)}…), the extracted server passes the MCP smoke test`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
