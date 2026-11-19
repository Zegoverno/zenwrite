// zenwrite's MCP server (stdio). Tools to read, save and version notes in the folder named by
// `ZEN_PLUGIN_FILES`, AI tools that borrow the host's model through MCP sampling, and the app
// itself as the resource `ui://zenwrite/app` (an MCP App: Claude, ChatGPT and zenbot show it).
//
// Safety, in layers:
// - every path is relative to the files folder: Markdown only, no `..`, no absolute path, no dot
//   folder, no symlink out (mcp/fsio.ts); closed versions go to the data folder
//   (`ZEN_PLUGIN_DATA`/versions), and only an older `.versions/` beside the notes is read;
// - a save names the hash it was based on and is refused when the file moved on, so a note changed
//   elsewhere is never overwritten; one write at a time per note, through a temporary file and a
//   rename (core/notes.ts);
// - AI tools only propose; they never write. Without sampling in the client they say so.
//
// Host contract: zenbot's PLUGINS.md (`ZEN_PLUGIN_FILES`, `ZEN_PLUGIN_DATA`, sampling).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import * as ai from '../core/ai.ts';
import { Conflict, Notes } from '../core/notes.ts';
import { parseNote, withoutGhosts } from '../core/note.ts';
import { searchDocs, type Doc } from '../core/search.ts';
import { VersionError } from '../core/versions.ts';
import { Drafts } from './drafts.ts';
import { dataIo, listNotes, nodeIo, notePath, openData, openRoot, PathError, versionsIo } from './fsio.ts';
import { instructions } from './skills.ts';

export const UI_URI = 'ui://zenwrite/app';
export const NOT_AVAILABLE = "AI isn't available here: this client does not offer sampling (a model zenwrite may ask).";

const here = path.dirname(fileURLToPath(import.meta.url));
/** package.json's version, put in by the bundler (scripts/build-mcp.mjs); 'dev' when run unbundled. */
declare const __VERSION__: string | undefined;
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

export interface Options {
  /** The files folder; default `ZEN_PLUGIN_FILES`. */
  files?: string;
  /** The plugin's data folder, where versions are kept; default `ZEN_PLUGIN_DATA`. Without one,
   *  versions are kept beside the notes in `.versions/`. */
  data?: string;
  /** The built app (one HTML file); default `ui/dist/app.html` in the plugin. */
  html?: string;
  /** The skills folder; default `skills/` in the plugin. */
  skills?: string;
}

type Data = Record<string, unknown>;
const ok = (data: Data): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const fail = (message: string, data: Data = {}): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
  structuredContent: { error: message, ...data },
});
const unavailable = (reason = NOT_AVAILABLE): CallToolResult => ok({ available: false, message: reason });

export function createServer(opts: Options = {}): McpServer {
  const filesDir = opts.files ?? process.env.ZEN_PLUGIN_FILES;
  const dataDir = opts.data ?? process.env.ZEN_PLUGIN_DATA;
  const htmlFile = opts.html ?? path.resolve(here, '../../ui/dist/app.html');
  const skillsDir = opts.skills ?? path.resolve(here, '../../skills');
  const server = new McpServer({ name: 'zenwrite', version: VERSION }, {
    instructions: 'zenwrite: a calm Markdown writing app. Paths are relative to the notes folder. Read a note with zenwrite_read, save with zenwrite_save naming the hash you read (a refused save means the note changed: read it again). AI tools need the client to support sampling.',
  });

  // The notes folder, opened once and then reused; every tool says plainly when there is none.
  let folder: Promise<{ root: string; notes: Notes }> | null = null;
  const open = () => {
    if (!filesDir) return Promise.reject(new PathError('ZEN_PLUGIN_FILES is not set: zenwrite needs a notes folder to work in'));
    return (folder ??= (async () => {
      const root = await openRoot(filesDir);
      const files = nodeIo(root);
      // Versions in the data folder, still reading a history kept beside the notes.
      const vio = dataDir ? versionsIo(dataIo(await openData(dataDir)), files) : files;
      return { root, notes: new Notes(files, root, vio) };
    })().catch((e) => {
      folder = null; // try again next call (the folder may appear)
      throw e;
    }));
  };
  // Drafts: unsaved text, kept in the data folder; there is no draft without one.
  let draftsOf: Promise<Drafts> | null = null;
  const drafts = () => {
    if (!dataDir) return Promise.reject(new PathError('ZEN_PLUGIN_DATA is not set: drafts cannot be kept'));
    return (draftsOf ??= openData(dataDir).then((d) => new Drafts(d)).catch((e) => {
      draftsOf = null;
      throw e;
    }));
  };
  /** Runs a tool body, turning the folder's refusals into tool errors the caller can read. */
  const guard = <A>(f: (a: A) => Promise<CallToolResult>) => async (a: A): Promise<CallToolResult> => {
    try {
      return await f(a);
    } catch (e) {
      if (e instanceof Conflict) {
        return fail(`The note changed since you read it (now ${e.hash ?? 'missing'}). Nothing was written: read it again and redo your change on that text.`, {
          conflict: true, text: e.text, hash: e.hash,
        });
      }
      if (e instanceof PathError || e instanceof VersionError || e instanceof ai.AiRequestError) return fail(e.message);
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

  // --- the app ------------------------------------------------------------------------------

  registerAppResource(server, 'zenwrite', UI_URI, { description: 'The writing app: live Markdown preview, alternatives, ghosts, versions.' }, async () => {
    const html = await fs.readFile(htmlFile, 'utf8').catch(() => {
      throw new Error('the app is not built: run `npm run build` in the zenwrite folder');
    });
    return { contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: false } } }] };
  });

  const pathArg = z.string().describe('Note path relative to the notes folder, e.g. "ideas/Angels.md"');

  registerAppTool(server, 'zenwrite_open', {
    title: 'Open a note in zenwrite',
    description: 'Shows zenwrite on a note (it is created when first written to). Returns the note text and its hash.',
    inputSchema: { path: pathArg },
    _meta: { ui: { resourceUri: UI_URI } },
  }, guard(async ({ path: rel }: { path: string }) => {
    const { notes } = await open();
    const p = notePath(rel);
    const n = await notes.read(p);
    return ok({ path: p, text: n?.text ?? null, hash: n?.hash ?? null });
  }));

  server.registerTool('zenwrite_read', {
    title: 'Read a note',
    description: 'The note\'s text and its hash (pass the hash to zenwrite_save as base_hash).',
    inputSchema: { path: pathArg },
    annotations: { readOnlyHint: true },
  }, guard(async ({ path: rel }: { path: string }) => {
    const { notes } = await open();
    const p = notePath(rel);
    const n = await notes.read(p);
    return n ? ok({ path: p, ...n }) : fail('not found', { notFound: true });
  }));

  server.registerTool('zenwrite_list', {
    title: 'List notes',
    description: 'Every Markdown note in the notes folder (paths relative to it).',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, guard(async () => ok({ files: await listNotes((await open()).root) })));

  server.registerTool('zenwrite_save', {
    title: 'Save a note',
    description: 'Writes the whole note. base_hash is the hash from zenwrite_read (omit or null to create a new note). If the note changed since, nothing is written and the result is an error saying so: read it again.',
    inputSchema: { path: pathArg, text: z.string(), base_hash: z.string().nullish() },
    annotations: { idempotentHint: false, destructiveHint: true },
  }, guard(async ({ path: rel, text, base_hash }: { path: string; text: string; base_hash?: string | null }) => {
    const { notes } = await open();
    const p = notePath(rel);
    return ok({ path: p, ...(await notes.save(p, text, base_hash ?? null)) });
  }));

  // Drafts belong to the app: the text typed and not yet saved, so closing the editor loses nothing.
  // They never touch the notes folder, and a draft is not a save.
  server.registerTool('zenwrite_draft_get', {
    title: 'Read the draft of a note',
    description: 'The unsaved draft kept for a note ({draft: null} when there is none): its text, the hash of the note it began from, and when.',
    inputSchema: { path: pathArg },
    annotations: { readOnlyHint: true },
  }, guard(async ({ path: rel }: { path: string }) => ok({ path: notePath(rel), draft: await (await drafts()).get(notePath(rel)) })));

  server.registerTool('zenwrite_draft_put', {
    title: 'Keep a draft of a note',
    description: 'Keeps unsaved text for a note in the plugin\'s data folder (not the notes folder), replacing its earlier draft. base_hash is the hash of the note it began from.',
    inputSchema: { path: pathArg, text: z.string(), base_hash: z.string().nullish() },
    annotations: { idempotentHint: true },
  }, guard(async ({ path: rel, text, base_hash }: { path: string; text: string; base_hash?: string | null }) => {
    const p = notePath(rel);
    await (await drafts()).put(p, text, base_hash ?? null);
    return ok({ path: p });
  }));

  server.registerTool('zenwrite_draft_drop', {
    title: 'Drop the draft of a note',
    description: 'Forgets the draft kept for a note (after it was saved or discarded).',
    inputSchema: { path: pathArg },
    annotations: { idempotentHint: true },
  }, guard(async ({ path: rel }: { path: string }) => {
    const p = notePath(rel);
    await (await drafts()).drop(p);
    return ok({ path: p });
  }));

  server.registerTool('zenwrite_versions', {
    title: 'List a note\'s versions',
    description: 'The closed versions (number, date, changelog line) and whether the note has changes since the last one (an open version).',
    inputSchema: { path: pathArg },
    annotations: { readOnlyHint: true },
  }, guard(async ({ path: rel }: { path: string }) => {
    const { notes } = await open();
    const p = notePath(rel);
    return ok({ path: p, ...(await notes.state(p)) });
  }));

  server.registerTool('zenwrite_close_version', {
    title: 'Close the open version',
    description: 'Freezes the note as the next version (kept in the plugin\'s data folder) and adds the changelog line to its Changelog section.',
    inputSchema: { path: pathArg, changelog: z.string().describe('One short line: what changed'), base_hash: z.string().optional(), by: z.enum(['me', 'agent']).optional() },
  }, guard(async ({ path: rel, changelog, base_hash, by }: { path: string; changelog: string; base_hash?: string; by?: 'me' | 'agent' }) => {
    const { notes } = await open();
    const p = notePath(rel);
    return ok({ path: p, ...(await notes.close(p, changelog, by ?? 'agent', base_hash)) });
  }));

  server.registerTool('zenwrite_open_version', {
    title: 'Read a closed version',
    description: 'The text of closed version n of a note.',
    inputSchema: { path: pathArg, n: z.number().int().min(1) },
    annotations: { readOnlyHint: true },
  }, guard(async ({ path: rel, n }: { path: string; n: number }) => {
    const { notes } = await open();
    const p = notePath(rel);
    const text = await notes.version(p, n);
    return text === null ? fail(`no version ${n}`) : ok({ path: p, n, text });
  }));

  server.registerTool('zenwrite_branch_version', {
    title: 'Branch from a closed version',
    description: 'Starts a new open version of the note from closed version n (keeps today\'s changelog). Refused while a version is open.',
    inputSchema: { path: pathArg, n: z.number().int().min(1), base_hash: z.string().optional() },
    annotations: { destructiveHint: true },
  }, guard(async ({ path: rel, n, base_hash }: { path: string; n: number; base_hash?: string }) => {
    const { notes } = await open();
    const p = notePath(rel);
    return ok({ path: p, ...(await notes.branch(p, n, base_hash)) });
  }));

  // --- AI, by sampling ----------------------------------------------------------------------

  const canSample = () => !!server.server.getClientCapabilities()?.sampling;

  /** One completion from the host's model; `seen` is told which model answered. */
  const completer = (seen?: (model: string) => void): ai.Complete => async (system, prompt) => {
    const r = await server.server.createMessage({
      systemPrompt: system,
      messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
      maxTokens: 4096,
      includeContext: 'none',
    }, { timeout: 180_000 });
    if (typeof r.model === 'string') seen?.(r.model);
    const parts = Array.isArray(r.content) ? r.content : [r.content];
    return parts.map((c) => (c.type === 'text' ? c.text : '')).join('');
  };
  const complete = completer();

  /** The text an AI tool reads: given, or the note's body from its file (ghosted words left out). */
  async function pieceOf(a: { text?: string; path?: string }): Promise<string> {
    if (typeof a.text === 'string') return a.text;
    if (!a.path) throw new ai.AiRequestError('give the text, or the path of a note');
    const n = await (await open()).notes.read(notePath(a.path));
    if (!n) throw new ai.AiRequestError('not found');
    const note = parseNote(n.text);
    return withoutGhosts(note.body, note.ghosts);
  }

  /** An AI tool: unavailable without sampling; sampling refusals and failures come back as errors. */
  const aiTool = <A>(f: (a: A, ins: ai.Instructions) => Promise<Data>) => guard(async (a: A) => {
    if (!canSample()) return unavailable();
    try {
      return ok({ available: true, ...(await f(a, await instructions(skillsDir))) });
    } catch (e) {
      if (e instanceof ai.AiRequestError || e instanceof PathError) throw e;
      return fail(`The AI request failed: ${e instanceof Error ? e.message : String(e)}`, { available: true });
    }
  });

  const piece = { text: z.string().optional().describe('The text to read; or give path'), path: z.string().optional().describe('A note to read instead of text') };

  server.registerTool('zenwrite_alternatives', {
    title: 'Other ways to say it',
    description: 'AI: alternatives for a word, sentence or paragraph, to drop in where the original stands.',
    inputSchema: {
      paragraph: z.string(), target: z.string(), scope: z.enum(['word', 'sentence', 'paragraph']),
      title: z.string().optional(), existing: z.array(z.string()).optional(), count: z.number().int().min(1).max(8).optional(),
    },
    annotations: { readOnlyHint: true },
  }, aiTool(async (a: ai.SuggestRequest) => {
    let model = '';
    return { ...(await ai.alternatives(completer((m) => (model = m)), a)), model };
  }));

  server.registerTool('zenwrite_check', {
    title: 'Proofread a note',
    description: 'AI: small local fixes (spelling, punctuation, grammar, clarity), or with mode "marks" pointers at weak, long and filler text. Proposals only: each names exact words in the note.',
    inputSchema: { ...piece, mode: z.enum(['fixes', 'marks']).optional() },
    annotations: { readOnlyHint: true },
  }, aiTool(async (a: { text?: string; path?: string; mode?: 'fixes' | 'marks' }, ins) => {
    const text = await pieceOf(a);
    return a.mode === 'marks' ? ai.marks(complete, text, ins) : ai.check(complete, text, ins);
  }));

  server.registerTool('zenwrite_shrink', {
    title: 'Shrink a note',
    description: 'AI: cuts, least needed first, adding up to about half the words. Proposals only.',
    inputSchema: piece,
    annotations: { readOnlyHint: true },
  }, aiTool(async (a: { text?: string; path?: string }, ins) => ai.shrink(complete, await pieceOf(a), ins)));

  server.registerTool('zenwrite_find_notes', {
    title: 'Find notes that help this piece',
    description: 'Searches the other notes in the folder and (with AI) proposes short notes linking the ones that help. Give queries to search without AI.',
    inputSchema: { ...piece, queries: z.array(z.string()).max(8).optional().describe('Search words; with them no AI is needed and the matching notes come back') },
    annotations: { readOnlyHint: true },
  }, guard(async (a: { text?: string; path?: string; queries?: string[] }) => {
    const { root, notes } = await open();
    const docs = async (): Promise<Doc[]> => {
      const out: Doc[] = [];
      for (const f of await listNotes(root)) {
        const n = await notes.read(f);
        if (n) out.push({ path: f, text: n.text });
      }
      return out;
    };
    const self = a.path ? notePath(a.path) : undefined;
    if (a.queries?.length) {
      const all = await docs();
      const hits = a.queries.flatMap((q) => searchDocs(all, q, 8, self));
      const seen = new Map(hits.map((h) => [h.path, h]));
      return ok({ available: false, hits: [...seen.values()].sort((x, y) => y.score - x.score).slice(0, 12) });
    }
    if (!canSample()) return unavailable();
    try {
      const text = await pieceOf(a);
      const all = await docs();
      const found = await ai.findNotes(complete, (q, limit) => searchDocs(all, q, limit, self), { path: self, text }, await instructions(skillsDir));
      return ok({ available: true, ...found });
    } catch (e) {
      if (e instanceof ai.AiRequestError || e instanceof PathError) throw e;
      return fail(`The AI request failed: ${e instanceof Error ? e.message : String(e)}`, { available: true });
    }
  }));

  server.registerTool('zenwrite_changelog_suggest', {
    title: 'Suggest a changelog line',
    description: 'AI: one changelog line for the open version, from what changed since the last closed version.',
    inputSchema: { path: pathArg },
    annotations: { readOnlyHint: true },
  }, aiTool(async ({ path: rel }: { path: string }, ins) => {
    const { notes } = await open();
    const p = notePath(rel);
    const n = await notes.read(p);
    if (!n) throw new ai.AiRequestError('not found');
    const s = await notes.state(p);
    const before = s.current ? await notes.version(p, s.current) : null;
    return ai.suggestLog(complete, n.text, s, before, ins);
  }));

  return server;
}

// Run as a program: stdio.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createServer().connect(new StdioServerTransport());
}
