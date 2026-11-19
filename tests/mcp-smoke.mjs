// The MCP smoke test against a plugin folder as zenbot installs it (the unpacked release archive,
// or this repo once built): `node tests/mcp-smoke.mjs [plugin folder]`. It runs the folder's
// mcp/dist/server.js from an empty working directory with a scratch notes folder and data folder,
// as a client without sampling, and checks: the tools, the app resource, every non-AI tool once,
// that the AI tools answer "AI isn't available here", path refusals, and an unset ZEN_PLUGIN_FILES.
// The client is the test's (this repo's SDK); the server must need nothing but node.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const plugin = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..'));
const manifest = JSON.parse(readFileSync(path.join(plugin, 'plugin.json'), 'utf8'));
const name = manifest.name;
const server = path.join(plugin, ...manifest.server.args[0].split('/'));
const UI = `ui://${name}/app`;

const tmp = mkdtempSync(path.join(tmpdir(), `${name}-smoke-`));
const files = path.join(tmp, 'notes');
const data = path.join(tmp, 'data');
const cwd = path.join(tmp, 'cwd');
mkdirSync(path.join(files, 'ideas'), { recursive: true });
mkdirSync(cwd);
writeFileSync(path.join(files, 'Rivers.md'), '# Rivers\n\nWater flows to the sea. It is really very long.\n');
writeFileSync(path.join(files, 'ideas', 'Sea.md'), '# Sea\n\nThe sea is salt water.\n');

async function connect(env) {
  const client = new Client({ name: 'smoke', version: '0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { PATH: process.env.PATH ?? '', ...env }, cwd, stderr: 'pipe' }));
  return client;
}
const call = async (c, tool, args = {}) => c.callTool({ name: tool, arguments: args });
const ok = (r, what) => {
  assert.ok(!r.isError, `${what}: ${JSON.stringify(r.content)}`);
  return r.structuredContent;
};

const client = await connect({ ZEN_PLUGIN_FILES: files, ZEN_PLUGIN_DATA: data });
try {
  // tools and the app
  const tools = (await client.listTools()).tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'alternatives', 'branch_version', 'changelog_suggest', 'check', 'close_version', 'draft_drop', 'draft_get', 'draft_put', 'find_notes',
    'list', 'open', 'open_version', 'read', 'save', 'shrink', 'versions',
  ].map((t) => `${name}_${t}`).sort());
  assert.equal(tools.find((t) => t.name === `${name}_open`)._meta.ui.resourceUri, UI);
  for (const c of manifest.contributes.commands ?? []) assert.ok(names.includes(c.tool), `command /${c.name} names a tool`);
  for (const o of manifest.contributes.openers ?? []) assert.equal(o.ui, UI);
  const res = (await client.readResource({ uri: UI })).contents[0];
  assert.equal(res.mimeType, 'text/html;profile=mcp-app');
  assert.match(res.text, /<html/i);

  // every non-AI tool
  const open = ok(await call(client, `${name}_open`, { path: 'Rivers.md' }), 'open');
  assert.match(open.text, /Water flows/);
  const read = ok(await call(client, `${name}_read`, { path: 'Rivers.md' }), 'read');
  assert.equal(read.hash, open.hash);
  assert.deepEqual(ok(await call(client, `${name}_list`), 'list').files, ['ideas/Sea.md', 'Rivers.md']);
  const saved = ok(await call(client, `${name}_save`, { path: 'Rivers.md', text: `${read.text}\nMore.\n`, base_hash: read.hash }), 'save');
  assert.equal((await call(client, `${name}_save`, { path: 'Rivers.md', text: 'stale', base_hash: read.hash })).isError, true, 'a stale save is refused');
  assert.match(readFileSync(path.join(files, 'Rivers.md'), 'utf8'), /More\./);
  const state = ok(await call(client, `${name}_versions`, { path: 'Rivers.md' }), 'versions');
  assert.equal(state.open, true);
  const closed = ok(await call(client, `${name}_close_version`, { path: 'Rivers.md', changelog: 'more', base_hash: saved.hash }), 'close_version');
  assert.equal(closed.current, 2);
  assert.ok(existsSync(path.join(data, 'versions', 'Rivers.md', 'v2.md')), 'versions are kept in ZEN_PLUGIN_DATA');
  assert.ok(!existsSync(path.join(files, '.versions')), 'nothing but notes in the notes folder');
  assert.doesNotMatch(ok(await call(client, `${name}_open_version`, { path: 'Rivers.md', n: 1 }), 'open_version').text, /More\./);
  const branched = ok(await call(client, `${name}_branch_version`, { path: 'Rivers.md', n: 1, base_hash: closed.hash }), 'branch_version');
  assert.doesNotMatch(branched.text, /More\./);
  const hits = ok(await call(client, `${name}_find_notes`, { path: 'Rivers.md', queries: ['salt water'] }), 'find_notes with queries').hits;
  assert.deepEqual(hits.map((h) => h.path), ['ideas/Sea.md']);

  // drafts: kept in the data folder, never in the notes folder, and not a save
  assert.equal(ok(await call(client, `${name}_draft_get`, { path: 'Rivers.md' }), 'draft_get').draft, null);
  ok(await call(client, `${name}_draft_put`, { path: 'Rivers.md', text: '# Rivers\n\nHalf typed', base_hash: 'abc' }), 'draft_put');
  const kept = ok(await call(client, `${name}_draft_get`, { path: 'Rivers.md' }), 'draft_get').draft;
  assert.equal(kept.text, '# Rivers\n\nHalf typed');
  assert.equal(kept.base, 'abc');
  assert.ok(existsSync(path.join(data, 'drafts')), 'drafts are kept in ZEN_PLUGIN_DATA');
  assert.doesNotMatch(readFileSync(path.join(files, 'Rivers.md'), 'utf8'), /Half typed/);
  ok(await call(client, `${name}_draft_drop`, { path: 'Rivers.md' }), 'draft_drop');
  assert.equal(ok(await call(client, `${name}_draft_get`, { path: 'Rivers.md' }), 'draft_get').draft, null);
  assert.equal((await call(client, `${name}_draft_put`, { path: '../x.md', text: 'x' })).isError, true);

  // AI tools, without sampling
  for (const [tool, args] of [
    ['alternatives', { paragraph: 'A big day.', target: 'big', scope: 'word' }],
    ['check', { path: 'Rivers.md' }],
    ['shrink', { text: 'A long piece.' }],
    ['find_notes', { path: 'Rivers.md' }],
    ['changelog_suggest', { path: 'Rivers.md' }],
  ]) {
    const d = ok(await call(client, `${name}_${tool}`, args), tool);
    assert.equal(d.available, false, tool);
    assert.match(d.message, /AI isn't available here/, tool);
  }

  // confinement
  for (const bad of ['../x.md', '/etc/passwd.md', '.versions/Rivers.md/v1.md', '.git/x.md', 'a.txt']) {
    assert.equal((await call(client, `${name}_read`, { path: bad })).isError, true, `read ${bad}`);
    assert.equal((await call(client, `${name}_save`, { path: bad, text: 'x' })).isError, true, `save ${bad}`);
  }
} finally {
  await client.close();
}

// no ZEN_PLUGIN_FILES: file tools say so and refuse
const bare = await connect({});
try {
  const r = await call(bare, `${name}_read`, { path: 'Rivers.md' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /ZEN_PLUGIN_FILES is not set/);
  assert.equal((await call(bare, `${name}_draft_put`, { path: 'Rivers.md', text: 'x' })).isError, true, 'no data folder, no drafts');
} finally {
  await bare.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`mcp smoke ok: ${server}`);
