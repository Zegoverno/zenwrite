// How the page takes part in zenbot's keyboard model (zenbot's PLUGINS.md, "Keys and commands"). An
// iframe swallows the keys pressed in it, so the page tells zenbot its commands (`zen/commands`),
// forwards the keys it did not use (`zen/key`) and runs what zenbot picks (`zen/command`), and puts
// the focus in the editor when zenbot says so (`zen/focus`). Only under zenbot: elsewhere none of it
// is sent and the page keeps its keys. The functions here are plain; main-app.ts connects them to the
// App's channel and the Editor declares what it can do.

export interface ZenCommand {
  /** `[a-z0-9-]{1,32}`, stable across sends. */
  id: string;
  /** Up to 60 characters. */
  title: string;
  /** The default shortcut in zenbot's key form (`Mod+s`). */
  key?: string;
  /** Asks for a place in zenbot's quick-control ring. */
  ring?: boolean;
  icon?: string;
}

export interface ZenKey {
  key: string;
  code: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  typing: boolean;
}

/** What the page offers zenbot; absent outside zenbot. */
export interface ZenHost {
  /** Declares the page's commands, replacing the previous list. */
  commands(list: ZenCommand[]): void;
  /** Called with the id of a command the owner picked; returns how to stop listening. */
  onCommand(fn: (id: string) => void): () => void;
  /** Called when the panel gains or loses the keyboard focus. */
  onFocus(fn: (focused: boolean) => void): () => void;
}

/** What zenbot accepts: up to 30 commands, valid ids, titles of at most 60 characters. */
export function cleanCommands(list: ZenCommand[]): ZenCommand[] {
  const seen = new Set<string>();
  const out: ZenCommand[] = [];
  for (const c of list) {
    if (!/^[a-z0-9-]{1,32}$/.test(c.id) || seen.has(c.id) || !c.title) continue;
    seen.add(c.id);
    out.push({ ...c, title: c.title.slice(0, 60) });
    if (out.length === 30) break;
  }
  return out;
}

/** The page's own commands, for what is open: a note being written, a closed version (read-only),
 *  or a note shown to read. The first three keys ask for the ring; the keys are Mod chords because the
 *  editor is a typing area, and none is zenbot's (Mod+k, Mod+., Mod+\, Mod+Shift+\) or the editor's. */
export function writerCommands(s: { reading: boolean; viewing: boolean }): ZenCommand[] {
  if (s.reading) return [];
  const leave: ZenCommand[] = [
    { id: 'open-note', title: 'Open a note' },
    { id: 'back-to-reading', title: 'Back to reading' },
  ];
  if (s.viewing) return leave;
  return [
    { id: 'save', title: 'Save', key: 'Mod+s', ring: true },
    { id: 'proofread', title: 'Proofread', key: 'Mod+Shift+f', ring: true },
    { id: 'shrink', title: 'Shrink', key: 'Mod+Shift+u', ring: true },
    { id: 'marks', title: 'Marks', key: 'Mod+Shift+e' },
    { id: 'find-notes', title: 'Find notes', key: 'Mod+Shift+y' },
    { id: 'alternatives', title: 'Alternatives for the selection' },
    { id: 'tools', title: 'Next tools tab' },
    { id: 'note-panel', title: 'Next note tab' },
    { id: 'done', title: 'Save and go back to reading' },
    ...leave,
  ];
}

export const onMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

const MODIFIERS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Dead', 'Process']);

/** zenbot's key form of a keydown: `Mod` (Ctrl, or Cmd on a Mac), `Alt`, `Shift`, then the key, letters
 *  in lower case and `Space` for the space bar. Shift is written only with letters and named keys. */
export function keyForm(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac = onMac()): string {
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const named = key.length > 1 || /\p{L}/u.test(key);
  return [(mac ? e.metaKey : e.ctrlKey) ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey && named ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** The keydown as zenbot wants it. */
export function keyMessage(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, typing: boolean): ZenKey {
  return { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, typing };
}

/** Whether focus is in a text field or an editable area. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as (Element & { isContentEditable?: boolean }) | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Whether a keydown goes to zenbot: not a bare modifier or a composition, and while typing only
 *  with Ctrl or Meta. */
export function forwardable(k: ZenKey, composing = false): boolean {
  if (composing || MODIFIERS.has(k.key)) return false;
  return !k.typing || k.ctrl || k.meta;
}

/** The bridge over a way to send notifications; `received` takes what zenbot sent. */
export function zenBridge(send: (method: string, params: Record<string, unknown>) => void) {
  const commandFns = new Set<(id: string) => void>();
  const focusFns = new Set<(focused: boolean) => void>();
  let declared: ZenCommand[] = [];
  let sent = '';
  return {
    /** The commands zenbot has now. */
    get declared() { return declared; },
    host: {
      commands(list: ZenCommand[]) {
        declared = cleanCommands(list);
        const wire = JSON.stringify(declared);
        if (wire === sent) return;
        sent = wire;
        send('zen/commands', { commands: declared });
      },
      onCommand(fn) { commandFns.add(fn); return () => void commandFns.delete(fn); },
      onFocus(fn) { focusFns.add(fn); return () => void focusFns.delete(fn); },
    } satisfies ZenHost,
    key(k: ZenKey) { send('zen/key', { ...k }); },
    /** Whether the keydown is a declared command's shortcut. */
    isShortcut(e: Parameters<typeof keyForm>[0]): boolean {
      const f = keyForm(e);
      return declared.some((c) => c.key === f);
    },
    /** A notification from zenbot (`zen/command`, `zen/focus`); anything else is ignored. */
    received(method: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      if (method === 'zen/command' && typeof p.id === 'string') for (const f of [...commandFns]) f(p.id);
      else if (method === 'zen/focus' && typeof p.focused === 'boolean') for (const f of [...focusFns]) f(p.focused);
    },
    /** Zenbot lost the list (the frame was rebuilt): the next declaration is sent again. */
    reset() { sent = ''; },
  };
}
export type ZenBridge = ReturnType<typeof zenBridge>;

/** Forwards the page's unhandled keydowns to zenbot while `active()`. A declared shortcut is the
 *  command's, not the browser's (Ctrl+S would offer to save the page), so it is stopped here;
 *  everything else is left as it is. The decision waits until the other handlers have run, so a key
 *  the page or the editor used is not sent. */
export function forwardKeys(bridge: ZenBridge, active: () => boolean, target: Pick<Window, 'addEventListener'> = window) {
  target.addEventListener('keydown', (e) => {
    if (!active()) return;
    const typing = isTyping(e.target);
    const k = keyMessage(e, typing);
    const mine = !e.defaultPrevented && bridge.isShortcut(e);
    if (mine) e.preventDefault();
    setTimeout(() => {
      if ((e.defaultPrevented && !mine) || !forwardable(k, e.isComposing)) return;
      bridge.key(k);
    }, 0);
  });
}
