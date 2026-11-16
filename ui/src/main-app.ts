// The MCP App entry: the app inside a host. One self-contained HTML file (vite-plugin-singlefile)
// served by the plugin's server as ui://zenwrite/app.
import { mount } from 'svelte';
import { App as McpApp, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import App from './App.svelte';
import { nav, requestOpen, type ZenContext } from './lib/nav.svelte.ts';
import { mcpAi, mcpHost, mcpStore } from './stores/mcp.ts';
import './app.css';

const app = new McpApp({ name: 'zenwrite', version: __VERSION__ });

/** Follows the host's theme and, when it gives them, its colors; the page keeps its own serif. */
function look(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  const v = ctx.styles?.variables;
  if (v) {
    applyHostStyleVariables(v);
    const root = document.documentElement.style;
    const map: Array<[string, string]> = [['--paper', '--color-background-primary'], ['--ink', '--color-text-primary'], ['--dim', '--color-text-secondary'], ['--faint', '--color-border-primary']];
    for (const [mine, theirs] of map) if (v[theirs as keyof typeof v]) root.setProperty(mine, `var(${theirs})`);
  }
}

/** zenbot's part of the host context, `{ pane, path, mode, slot }`; undefined in other hosts. Only
 *  the values it knows are kept, so a host that sends something else changes nothing. */
function zenOf(ctx: McpUiHostContext | undefined): ZenContext | undefined {
  const z = (ctx as { zen?: unknown } | undefined)?.zen;
  if (!z || typeof z !== 'object') return undefined;
  const o = z as Record<string, unknown>;
  const one = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined);
  return {
    pane: one(o.pane, ['board', 'side'] as const),
    path: typeof o.path === 'string' && o.path ? o.path : null,
    mode: one(o.mode, ['read', 'edit'] as const),
    slot: one(o.slot, ['view', 'opener', 'game'] as const),
  };
}

/** Where the app sits, for the CSS (`data-pane`, `data-slot`) and the editor (`mode`). */
function place(z: ZenContext | undefined) {
  nav.zen = z ?? null;
  const root = document.documentElement.dataset;
  for (const k of ['pane', 'slot', 'mode'] as const) {
    if (z?.[k]) root[k] = z[k];
    else delete root[k];
  }
}

// A tool result is the app's cue: zenwrite_open's carries the note; a refusal shows its reason.
app.ontoolresult = (r) => {
  const d = (r.structuredContent ?? {}) as { path?: string; text?: string | null; hash?: string | null; error?: string };
  if (r.isError) nav.error = d.error ?? 'zenwrite could not open that note.';
  else if (typeof d.path === 'string') requestOpen(d.path, d.text, d.hash);
};
// A change holds only what changed: the note moves only when it carries zenbot's context.
app.onhostcontextchanged = (changed) => {
  const ctx = app.getHostContext();
  look(ctx);
  if (!changed || !('zen' in changed)) return;
  const z = zenOf(ctx);
  place(z);
  if (z?.path && z.path !== nav.request?.path) requestOpen(z.path);
};

await app.connect();
look(app.getHostContext());
const zen = zenOf(app.getHostContext());
place(zen);
if (zen?.path && !nav.request) requestOpen(zen.path);

mount(App, { target: document.getElementById('app')!, props: { store: mcpStore(app), ai: mcpAi(app), host: mcpHost(app) } });
