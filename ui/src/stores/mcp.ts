// The app inside a host (zenbot, Claude, ChatGPT): notes and the AI are the plugin's own MCP tools,
// called through the host with the SDK's `App.callServerTool`; the host routes them (zenbot, through
// its kernel, which checks permissions and records them). A refused save arrives as a tool error.

import type { App } from '@modelcontextprotocol/ext-apps';
import type { Ai, Changed, Fix, Host, Proposal, Store, SuggestRequest, VersionState } from '../lib/ports.ts';
import { Conflict } from '../lib/ports.ts';

type Data = Record<string, unknown>;

async function call(app: App, name: string, args: Data = {}): Promise<{ data: Data; error: boolean }> {
  const r = await app.callServerTool({ name, arguments: args });
  let data = (r.structuredContent ?? null) as Data | null;
  if (!data) {
    const text = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    try {
      data = JSON.parse(text) as Data;
    } catch {
      data = { error: text || 'the tool failed' };
    }
  }
  return { data, error: !!r.isError };
}

/** Calls a tool; its error becomes an exception (a refused save, a Conflict). */
async function ask(app: App, name: string, args?: Data): Promise<Data> {
  const { data, error } = await call(app, name, args);
  if (error) {
    if (data.conflict) throw new Conflict((data.text as string | null) ?? null, (data.hash as string | null) ?? null);
    throw new Error(String(data.error ?? 'the tool failed'));
  }
  return data;
}

export function mcpStore(app: App, label = 'Notes'): Store {
  return {
    label,
    canVersion: true,
    // Each poll is a tool call on the host's record: a slow one.
    pollMs: 20_000,
    async files() { return (await ask(app, 'zenwrite_list')).files as string[]; },
    async read(path) {
      const { data, error } = await call(app, 'zenwrite_read', { path });
      if (error) {
        if (data.notFound) return null;
        throw new Error(String(data.error));
      }
      return { text: data.text as string, hash: data.hash as string };
    },
    async write(path, text, base) { return { hash: (await ask(app, 'zenwrite_save', { path, text, base_hash: base })).hash as string }; },
    drafts: {
      async get(path) {
        const d = (await ask(app, 'zenwrite_draft_get', { path })).draft as { text: string; base: string | null } | null;
        return d && typeof d.text === 'string' ? { text: d.text, base: d.base ?? null } : null;
      },
      async put(path, text, base) { await ask(app, 'zenwrite_draft_put', { path, text, base_hash: base }); },
      async drop(path) { await ask(app, 'zenwrite_draft_drop', { path }); },
    },
    async versions(path) { return (await ask(app, 'zenwrite_versions', { path })) as unknown as VersionState; },
    async version(path, n) {
      const { data, error } = await call(app, 'zenwrite_open_version', { path, n });
      return error ? null : (data.text as string);
    },
    async close(path, base, log) { return (await ask(app, 'zenwrite_close_version', { path, changelog: log, base_hash: base, by: 'me' })) as unknown as Changed; },
    async branch(path, base, n) { return (await ask(app, 'zenwrite_branch_version', { path, n, base_hash: base })) as unknown as Changed; },
  };
}

/** The AI tools; a host without sampling answers `available: false`, which reads as an error here. */
export function mcpAi(app: App): Ai {
  async function run(name: string, args: Data): Promise<Data> {
    const data = await ask(app, name, args);
    if (data.available === false) throw new Error(String(data.message ?? "AI isn't available here"));
    return data;
  }
  return {
    async alternatives(req: SuggestRequest) {
      const d = await run('zenwrite_alternatives', { ...req });
      return { alternatives: d.alternatives as string[], model: typeof d.model === 'string' && d.model ? d.model : undefined };
    },
    async check(text) { return (await run('zenwrite_check', { text })).fixes as Fix[]; },
    async marks(text) { return (await run('zenwrite_check', { text, mode: 'marks' })).fixes as Fix[]; },
    async shrink(text) { return (await run('zenwrite_shrink', { text })).fixes as Fix[]; },
    async findNotes(path, text) { return (await run('zenwrite_find_notes', { path, text })).notes as Proposal[]; },
    async changelog(path) { return (await run('zenwrite_changelog_suggest', { path })).log as string; },
  };
}

/** zenbot's link to a file: `zen://open?path=<relative path>`. */
export const zenOpen = (path: string, mode?: 'read' | 'edit') => `zen://open?path=${encodeURIComponent(path)}${mode ? `&mode=${mode}` : ''}`;

export function mcpHost(app: App): Host {
  return {
    openUrl: (url) => void app.openLink({ url }).catch(() => {}),
    // A file that is not a note: the host opens it (zenbot understands this link; others ignore it).
    openFile: (path) => void app.openLink({ url: zenOpen(path) }).catch(() => {}),
    // In zenbot (its context is there) another note goes to the host, which sends it to that note's
    // opener and keeps its panes in step; elsewhere the app opens it itself.
    async openNote(path, mode) {
      if (!(app.getHostContext() as { zen?: unknown } | undefined)?.zen) return false;
      const r = await app.openLink({ url: zenOpen(path, mode) });
      return !r.isError;
    },
    noteOpened: (path) => void app.updateModelContext({ content: [{ type: 'text', text: `zenwrite has the note ${path} open.` }] }).catch(() => {}),
  };
}
