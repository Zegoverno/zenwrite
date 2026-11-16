// Asks the app to open a note from outside it: the MCP host (a tool result, the zen context) or a
// test. `text` and `hash` come with the request when the caller already has them.
export const nav = $state<{
  request: { path: string; text?: string | null; hash?: string | null; n: number } | null;
  error: string;
  /** zenbot's part of the host context, when there is one: where the app sits and why it was opened. */
  zen: ZenContext | null;
}>({ request: null, error: '', zen: null });

export interface ZenContext {
  pane?: 'board' | 'side';
  path?: string | null;
  mode?: 'read' | 'edit';
  slot?: 'view' | 'opener' | 'game';
}

let n = 0;
export function requestOpen(path: string, text?: string | null, hash?: string | null) {
  nav.request = { path, text, hash, n: ++n };
}
