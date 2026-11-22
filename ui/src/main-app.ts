// The MCP App entry: the app inside a host. One self-contained HTML file (vite-plugin-singlefile)
// served by the plugin's server as ui://zenwrite/app.
import { mount } from 'svelte';
import { App as McpApp, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import App from './App.svelte';
import { sizeOf, tokenAliases, zenOf } from './lib/host.ts';
import { nav, requestOpen, type ZenContext } from './lib/nav.svelte.ts';
import { forwardKeys, zenBridge } from './lib/zen.ts';
import { mcpAi, mcpHost, mcpStore } from './stores/mcp.ts';
import './app.css';

const app = new McpApp({ name: 'zenwrite', version: __VERSION__ });

/** Follows the host's theme and colours, fonts, radii and shadow (its variables become the page's
 *  tokens, see lib/host.ts), and its container's size; the note itself keeps its serif. Resent by the
 *  host on change, so it is all live. */
function look(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  const root = document.documentElement;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  const v = ctx.styles?.variables;
  if (v) {
    applyHostStyleVariables(v);
    for (const [mine, value] of tokenAliases(v as Record<string, string | undefined>)) root.style.setProperty(mine, value);
  }
  const size = sizeOf(ctx);
  if (size) {
    root.style.setProperty('--host-width', `${size.width}px`);
    root.style.setProperty('--host-height', `${size.height}px`);
    root.dataset.size = size.width < 760 ? 'compact' : 'roomy';
  }
}

/** Where the app sits, for the CSS (`data-pane`, `data-slot`) and the editor (`mode`). */
function place(z: ZenContext | undefined) {
  nav.zen = z ?? null;
  const root = document.documentElement.dataset;
  for (const k of ['pane', 'slot', 'mode'] as const) {
    if (z?.[k]) root[k] = z[k];
    else delete root[k];
  }
  if (z?.phone) root.phone = '';
  else delete root.phone;
  const style = document.documentElement.style;
  if (z?.headingFont) style.setProperty('--zw-heading-font', z.headingFont);
  else style.removeProperty('--zw-heading-font');
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

// zenbot's keyboard model (lib/zen.ts): under zenbot only, the page declares its commands, hands over the
// keys it did not use and runs what zenbot picks. The channel carries any method: the SDK does not
// check `zen/` notifications, so they go out with `notification` and come in by the fallback handler.
const zenb = zenBridge((method, params) => {
  if (nav.zen) void app.notification({ method, params } as never).catch(() => {});
});
app.fallbackNotificationHandler = async (n) => zenb.received(n.method, n.params);
forwardKeys(zenb, () => !!nav.zen);

await app.connect();
look(app.getHostContext());
const zen = zenOf(app.getHostContext());
place(zen);
if (zen?.path && !nav.request) requestOpen(zen.path);

mount(App, { target: document.getElementById('app')!, props: { store: mcpStore(app), ai: mcpAi(app), host: mcpHost(app, zenb.host) } });
