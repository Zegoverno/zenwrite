// What the page takes from its host's context, as plain functions (main-app.ts applies them):
// the host's style variables become the page's own tokens, zenbot's `zen` part is read
// defensively, and the container's size says how roomy the page is.

import type { ZenContext } from './nav.svelte.ts';

/** The page's token ← the host's MCP Apps variable (the first one the host gives). The page keeps
 *  its serif for the note itself; everything around it follows the host. */
export const TOKENS: Array<[string, string[]]> = [
  ['--paper', ['--color-background-primary']],
  ['--soft', ['--color-background-secondary']],
  ['--ink', ['--color-text-primary']],
  ['--dim', ['--color-text-secondary']],
  ['--faint', ['--color-border-primary']],
  ['--accent', ['--color-text-info', '--color-ring-primary']],
  ['--accent-soft', ['--color-background-info']],
  ['--on-accent', ['--color-text-inverse']],
  ['--err', ['--color-text-danger']],
  ['--ok', ['--color-text-success']],
  ['--warn', ['--color-text-warning']],
  ['--sans', ['--font-sans']],
  ['--mono', ['--font-mono']],
  ['--radius-sm', ['--border-radius-sm']],
  ['--radius-md', ['--border-radius-md']],
  ['--radius-lg', ['--border-radius-lg']],
  ['--radius-full', ['--border-radius-full']],
  ['--shadow', ['--shadow-md']],
];

/** The [token, value] pairs to set: each token points at the host's variable (`var(--color-…)`),
 *  so a host that resends its variables moves the page with it. Variables the host did not give
 *  leave the page's own value. */
export function tokenAliases(vars: Record<string, string | undefined> | undefined): Array<[string, string]> {
  if (!vars) return [];
  const out: Array<[string, string]> = [];
  for (const [mine, theirs] of TOKENS) {
    const from = theirs.find((t) => vars[t]);
    if (from) out.push([mine, `var(${from})`]);
  }
  return out;
}

/** zenbot's part of the host context. Only the values it knows are kept, so a host that sends
 *  something else changes nothing; undefined in other hosts. */
export function zenOf(ctx: unknown): ZenContext | undefined {
  const z = (ctx as { zen?: unknown } | undefined)?.zen;
  if (!z || typeof z !== 'object') return undefined;
  const o = z as Record<string, unknown>;
  const one = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined);
  return {
    pane: one(o.pane, ['board', 'side'] as const),
    path: typeof o.path === 'string' && o.path ? o.path : null,
    mode: one(o.mode, ['read', 'edit'] as const),
    slot: one(o.slot, ['view', 'opener', 'game'] as const),
    phone: o.phone === true,
    headingFont: typeof o.headingFont === 'string' ? headingFont(o.headingFont) : undefined,
  };
}

/** A font-family list for headings, or undefined: names, quotes, commas and hyphens only. */
export function headingFont(v: string): string | undefined {
  const s = v.trim();
  return s && s.length <= 200 && /^[\w\s"',.-]+$/.test(s) ? s : undefined;
}

/** The container's size in whole pixels, when the host gives a usable one. */
export function sizeOf(ctx: unknown): { width: number; height: number } | undefined {
  const d = (ctx as { containerDimensions?: { width?: unknown; height?: unknown } } | undefined)?.containerDimensions;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100_000;
  return d && ok(d.width) && ok(d.height) ? { width: Math.round(d.width), height: Math.round(d.height) } : undefined;
}
