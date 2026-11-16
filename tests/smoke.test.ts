// The MCP server as a host sees it: the built mcp/dist/server.js over stdio, with the SDK client.
// Needs `npm run build` first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const SERVER = path.resolve(import.meta.dirname, '../mcp/dist/server.js');
const NOTE = '# Rivers\n\nWater flows to the sea. It is really very long.\n';

type Handler = (system: string, prompt: string) => string;

async function connect(files: string | null, sampling?: Handler, data: string | null = dataDir): Promise<Client> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (files) env.ZEN_PLUGIN_FILES = files;
  if (data) env.ZEN_PLUGIN_DATA = data;
  const client = new Client({ name: 'smoke', version: '0' }, { capabilities: sampling ? { sampling: {} } : {} });
  if (sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
      const c = req.params.messages[0].content as { text: string };
      return { role: 'assistant', model: 'stub', content: { type: 'text', text: sampling(req.params.systemPrompt ?? '', c.text) } };
    });
  }
  await client.connect(new StdioClientTransport({ command: 'node', args: [SERVER], env, cwd: path.dirname(SERVER) }));
  return client;
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as CallToolResult;
const data = (r: CallToolResult) => r.structuredContent as Record<string, any>;

let dir: string;
let dataDir: string;
let outside: string;
let client: Client;
beforeAll(async () => {
  expect(existsSync(SERVER), 'run `npm run build` first').toBe(true);
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-files-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-out-'));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-data-'));
  await fs.writeFile(path.join(dir, 'Rivers.md'), NOTE);
  await fs.mkdir(path.join(dir, 'ideas'));
  await fs.writeFile(path.join(dir, 'ideas/Sea.md'), '# Sea\n\nThe sea is salt water.\n');
  await fs.writeFile(path.join(outside, 'secret.md'), 'secret');
  await fs.symlink(outside, path.join(dir, 'escape'));
  client = await connect(dir);
});
afterAll(async () => {
  await client.close();
});

describe('the server', () => {
  it('lists its tools and the app resource', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'zenwrite_alternatives', 'zenwrite_branch_version', 'zenwrite_changelog_suggest', 'zenwrite_check', 'zenwrite_close_version', 'zenwrite_find_notes',
      'zenwrite_list', 'zenwrite_open', 'zenwrite_open_version', 'zenwrite_read', 'zenwrite_save', 'zenwrite_shrink', 'zenwrite_versions',
    ]);
    const open = tools.find((t) => t.name === 'zenwrite_open')!;
    expect((open._meta as any).ui.resourceUri).toBe('ui://zenwrite/app');
    expect((await client.listResources()).resources.map((r) => r.uri)).toContain('ui://zenwrite/app');
    const res = await client.readResource({ uri: 'ui://zenwrite/app' });
    expect(res.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect((res.contents[0] as { text: string }).text).toContain('<html');
  });

  it('opens, reads and lists', async () => {
    const open = data(await call(client, 'zenwrite_open', { path: 'Rivers.md' }));
    expect(open).toMatchObject({ path: 'Rivers.md', text: NOTE });
    expect(open.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(data(await call(client, 'zenwrite_open', { path: 'New.md' }))).toMatchObject({ text: null, hash: null });
    const read = data(await call(client, 'zenwrite_read', { path: 'Rivers.md' }));
    expect(read.hash).toBe(open.hash);
    expect(data(await call(client, 'zenwrite_list')).files).toEqual(['ideas/Sea.md', 'Rivers.md']);
    expect((await call(client, 'zenwrite_read', { path: 'Nope.md' })).isError).toBe(true);
  });

  it('saves, refuses a stale save and a note changed on disk, and keeps one write at a time', async () => {
    const { hash } = data(await call(client, 'zenwrite_read', { path: 'Rivers.md' }));
    const saved = await call(client, 'zenwrite_save', { path: 'Rivers.md', text: `${NOTE}\nMore.\n`, base_hash: hash });
    expect(saved.isError).toBeFalsy();
    const stale = await call(client, 'zenwrite_save', { path: 'Rivers.md', text: 'Lost.\n', base_hash: hash });
    expect(stale.isError).toBe(true);
    expect(data(stale)).toMatchObject({ conflict: true, text: `${NOTE}\nMore.\n` });
    // the file was changed by something else
    await fs.writeFile(path.join(dir, 'Rivers.md'), '# Rivers\n\nChanged elsewhere.\n');
    const clash = await call(client, 'zenwrite_save', { path: 'Rivers.md', text: 'Mine.\n', base_hash: data(saved).hash });
    expect(clash.isError).toBe(true);
    expect(await fs.readFile(path.join(dir, 'Rivers.md'), 'utf8')).toBe('# Rivers\n\nChanged elsewhere.\n');
    // a new note: base_hash omitted creates; the same again is a conflict
    expect((await call(client, 'zenwrite_save', { path: 'ideas/New.md', text: '# New\n\nHello.\n' })).isError).toBeFalsy();
    expect((await call(client, 'zenwrite_save', { path: 'ideas/New.md', text: 'x' })).isError).toBe(true);
    // two saves at once from the same base: exactly one wins
    const base = data(await call(client, 'zenwrite_read', { path: 'ideas/New.md' })).hash;
    const both = await Promise.all([1, 2].map((n) => call(client, 'zenwrite_save', { path: 'ideas/New.md', text: `# New\n\nRace ${n}.\n`, base_hash: base })));
    expect(both.filter((r) => !r.isError)).toHaveLength(1);
    expect(await fs.readdir(path.join(dir, 'ideas'))).not.toContain(expect.stringMatching(/\.tmp$/));
  });

  it('closes a version with a changelog line and reads it back', async () => {
    const p = 'Versioned.md';
    const first = data(await call(client, 'zenwrite_save', { path: p, text: '# V\n\nOne.\n' }));
    expect(data(await call(client, 'zenwrite_versions', { path: p }))).toMatchObject({ current: 0, open: true, versions: [] });
    const closed = await call(client, 'zenwrite_close_version', { path: p, changelog: 'first draft', base_hash: first.hash });
    expect(closed.isError).toBeFalsy();
    expect(data(closed)).toMatchObject({ current: 1, open: false });
    expect(data(closed).text).toMatch(/## Changelog\n\n- \d{4}-\d\d-\d\d — v1: first draft \(agent\)/);
    const disk = await fs.readFile(path.join(dir, p), 'utf8');
    expect(disk).toBe(data(closed).text);
    // versions live in the plugin's data folder; the notes folder holds only notes
    expect(await fs.readFile(path.join(dataDir, 'versions/Versioned.md/v1.md'), 'utf8')).toBe(disk);
    expect(existsSync(path.join(dir, '.versions'))).toBe(false);
    expect((await call(client, 'zenwrite_close_version', { path: p, changelog: 'again' })).isError).toBe(true); // nothing changed
    expect(data(await call(client, 'zenwrite_open_version', { path: p, n: 1 })).text).toBe(disk);
    expect((await call(client, 'zenwrite_open_version', { path: p, n: 9 })).isError).toBe(true);
    // edit, close v2, branch from v1 only once nothing is open
    const edited = await call(client, 'zenwrite_save', { path: p, text: disk.replace('One.', 'One.\n\nTwo.'), base_hash: data(closed).hash });
    expect((await call(client, 'zenwrite_branch_version', { path: p, n: 1 })).isError).toBe(true);
    const v2 = data(await call(client, 'zenwrite_close_version', { path: p, changelog: 'added two', base_hash: data(edited).hash }));
    expect(v2.current).toBe(2);
    const branched = data(await call(client, 'zenwrite_branch_version', { path: p, n: 1, base_hash: v2.hash }));
    expect(branched.text).not.toContain('Two.');
    expect(branched.text).toContain('v2: added two');
  });

  it('reads a history kept beside the notes, and keeps versions there without a data folder', async () => {
    // a note the zenbot web writer versioned: .versions/ in the notes folder
    const v1 = '# Old\n\nFirst.\n';
    await fs.mkdir(path.join(dir, '.versions/Old.md'), { recursive: true });
    await fs.writeFile(path.join(dir, '.versions/Old.md/v1.md'), v1);
    await fs.writeFile(path.join(dir, '.versions/Old.md/index.json'), JSON.stringify([{ n: 1, date: '2026-01-01', by: 'owner', log: 'start' }]));
    await fs.writeFile(path.join(dir, 'Old.md'), v1);
    expect(data(await call(client, 'zenwrite_versions', { path: 'Old.md' }))).toMatchObject({ current: 1, open: false, versions: [{ n: 1, by: 'me', log: 'start' }] });
    expect(data(await call(client, 'zenwrite_open_version', { path: 'Old.md', n: 1 })).text).toBe(v1);
    const { hash } = data(await call(client, 'zenwrite_read', { path: 'Old.md' }));
    const saved = data(await call(client, 'zenwrite_save', { path: 'Old.md', text: v1 + '\nSecond.\n', base_hash: hash }));
    expect(data(await call(client, 'zenwrite_close_version', { path: 'Old.md', changelog: 'more', base_hash: saved.hash })).current).toBe(2);
    expect(await fs.readdir(path.join(dataDir, 'versions/Old.md'))).toEqual(['index.json', 'v2.md']);
    expect(await fs.readdir(path.join(dir, '.versions/Old.md'))).toEqual(['index.json', 'v1.md']);
    await fs.rm(path.join(dir, '.versions'), { recursive: true });

    // no ZEN_PLUGIN_DATA (an MCP host that only names the notes folder): versions beside the notes
    const plain = await connect(dir, undefined, null);
    try {
      const n = data(await call(plain, 'zenwrite_save', { path: 'Plain.md', text: '# P\n\nOne.\n' }));
      expect((await call(plain, 'zenwrite_close_version', { path: 'Plain.md', changelog: 'one', base_hash: n.hash })).isError).toBeFalsy();
      expect(existsSync(path.join(dir, '.versions/Plain.md/v1.md'))).toBe(true);
    } finally {
      await plain.close();
      await fs.rm(path.join(dir, '.versions'), { recursive: true, force: true });
    }
  });

  it('refuses paths that leave the folder', async () => {
    const outsideFile = path.join(outside, 'secret.md');
    for (const bad of ['../x.md', '/etc/passwd.md', outsideFile, '.versions/Versioned.md/v1.md', '.hidden/a.md', 'escape/secret.md', 'a.txt', 'ideas//Sea.md']) {
      expect((await call(client, 'zenwrite_read', { path: bad })).isError, `read ${bad}`).toBe(true);
      expect((await call(client, 'zenwrite_save', { path: bad, text: 'x', base_hash: null })).isError, `save ${bad}`).toBe(true);
    }
    await fs.symlink(outsideFile, path.join(dir, 'link.md'));
    expect((await call(client, 'zenwrite_read', { path: 'link.md' })).isError).toBe(true);
    expect(await fs.readdir(outside)).toEqual(['secret.md']);
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('secret');
  });

  it('says AI is not available when the client has no sampling', async () => {
    const results = [
      await call(client, 'zenwrite_check', { text: 'This are fine.' }),
      await call(client, 'zenwrite_shrink', { path: 'Rivers.md' }),
      await call(client, 'zenwrite_find_notes', { text: 'A piece.' }),
      await call(client, 'zenwrite_alternatives', { paragraph: 'A big day.', target: 'big', scope: 'word' }),
      await call(client, 'zenwrite_changelog_suggest', { path: 'Versioned.md' }),
    ];
    for (const r of results) {
      expect(r.isError).toBeFalsy();
      expect(data(r)).toMatchObject({ available: false });
      expect(data(r).message).toContain("AI isn't available here");
    }
  });

  it('finds notes by queries without any AI', async () => {
    const r = data(await call(client, 'zenwrite_find_notes', { path: 'Rivers.md', queries: ['salt water', 'sea'] }));
    expect(r.hits.map((h: any) => h.path)).toEqual(['ideas/Sea.md']);
  });

  it('refuses file tools when ZEN_PLUGIN_FILES is unset', async () => {
    const bare = await connect(null);
    try {
      const r = await call(bare, 'zenwrite_read', { path: 'Rivers.md' });
      expect(r.isError).toBe(true);
      expect(data(r).error).toContain('ZEN_PLUGIN_FILES');
      expect((await call(bare, 'zenwrite_list')).isError).toBe(true);
    } finally {
      await bare.close();
    }
  });
});

describe('with a client that offers sampling', () => {
  let ai: Client;
  const asked: Array<{ system: string; prompt: string }> = [];
  beforeAll(async () => {
    ai = await connect(dir, (system, prompt) => {
      asked.push({ system, prompt });
      if (system.includes('"alternatives"')) return '{"alternatives":["large","huge"]}';
      if (system.includes('"marks"')) return '{"marks":[{"find":"It is really very long.","kind":"weak","why":"flat"}]}';
      if (system.includes('the shorter text')) return '{"fixes":[{"find":" really very","replace":"","why":"filler"}]}';
      if (system.includes('"fixes"')) return '{"fixes":[{"find":"Water flows","replace":"Water flowed","kind":"grammar","why":"tense"},{"find":"not in the note","replace":"x","kind":"grammar","why":""}]}';
      if (prompt.includes('First answer with the searches')) return '{"search":["salt water"]}';
      if (prompt.includes('Answer with JSON only. Either search once more')) return '{"notes":[{"text":"Explains why the sea is salt.","page":"Sea"},{"text":"Invented.","page":"Missing"}]}';
      if (prompt.includes('Answer with the changelog line only')) return '- v2: "tightened the opening"';
      return '';
    });
  });
  afterAll(async () => {
    await ai.close();
  });

  it('answers each AI tool from the host\'s model, keeping only proposals that fit the note', async () => {
    const piece = '# Rivers\n\nWater flows to the sea. It is really very long.\n';
    expect(data(await call(ai, 'zenwrite_alternatives', { paragraph: 'A big day.', target: 'big', scope: 'word' }))).toMatchObject({ available: true, alternatives: ['large', 'huge'], model: 'stub' });
    expect(data(await call(ai, 'zenwrite_check', { text: piece })).fixes).toEqual([{ find: 'Water flows', replace: 'Water flowed', kind: 'grammar', why: 'tense' }]);
    expect(data(await call(ai, 'zenwrite_check', { text: piece, mode: 'marks' })).fixes[0]).toMatchObject({ kind: 'weak' });
    expect(data(await call(ai, 'zenwrite_shrink', { text: piece })).fixes).toEqual([{ find: ' really very', replace: '', kind: 'cut', why: 'filler' }]);
    const found = data(await call(ai, 'zenwrite_find_notes', { path: 'Rivers.md' }));
    expect(found).toMatchObject({ available: true, notes: [{ text: 'Explains why the sea is salt.', page: 'Sea' }], searched: ['salt water'] });
    // reading a note by path: the skills' instructions went along as the system prompt
    expect(asked.some((a) => a.system.includes('Proofread') || a.system.includes('proofread'))).toBe(true);
    const log = data(await call(ai, 'zenwrite_changelog_suggest', { path: 'Versioned.md' }));
    expect(log.available).toBe(true);
    expect(typeof log.log).toBe('string');
  });

  it('suggests a changelog line for an open version', async () => {
    const p = 'Log.md';
    const a = data(await call(ai, 'zenwrite_save', { path: p, text: '# L\n\nOne.\n' }));
    const closed = data(await call(ai, 'zenwrite_close_version', { path: p, changelog: 'start', base_hash: a.hash }));
    await call(ai, 'zenwrite_save', { path: p, text: closed.text.replace('One.', 'One.\n\nTwo.'), base_hash: closed.hash });
    expect(data(await call(ai, 'zenwrite_changelog_suggest', { path: p }))).toMatchObject({ available: true, log: 'tightened the opening' });
  });

  it('reports a failed sampling request as an error', async () => {
    const failing = await connect(dir, () => { throw new Error('user said no'); });
    try {
      const r = await call(failing, 'zenwrite_check', { text: 'x y' });
      expect(r.isError).toBe(true);
      expect(data(r).error).toContain('The AI request failed');
    } finally {
      await failing.close();
    }
  });

  it('refuses empty input', async () => {
    expect((await call(ai, 'zenwrite_check', { text: '   ' })).isError).toBe(true);
    expect((await call(ai, 'zenwrite_check', {})).isError).toBe(true);
  });
});
