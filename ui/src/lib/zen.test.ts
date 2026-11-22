import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanCommands, forwardable, forwardKeys, isTyping, keyForm, keyMessage, writerCommands, zenBridge } from './zen.ts';

const ev = (o: Partial<KeyboardEvent> = {}) => ({ key: 'a', code: 'KeyA', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('keyForm', () => {
  it('writes Mod, Alt, Shift, then the key, letters in lower case', () => {
    expect(keyForm(ev({ key: 's', ctrlKey: true }), false)).toBe('Mod+s');
    expect(keyForm(ev({ key: 'F', ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+f');
    expect(keyForm(ev({ key: 'ArrowUp', altKey: true, shiftKey: true }), false)).toBe('Alt+Shift+ArrowUp');
  });
  it('is Cmd on a Mac and Ctrl elsewhere', () => {
    expect(keyForm(ev({ key: 's', metaKey: true }), true)).toBe('Mod+s');
    expect(keyForm(ev({ key: 's', ctrlKey: true }), true)).toBe('s');
    expect(keyForm(ev({ key: 's', metaKey: true }), false)).toBe('s');
  });
  it('writes Space, and Shift only with letters and named keys', () => {
    expect(keyForm(ev({ key: ' ', ctrlKey: true }), false)).toBe('Mod+Space');
    expect(keyForm(ev({ key: '?', shiftKey: true }), false)).toBe('?');
    expect(keyForm(ev({ key: 'Enter', shiftKey: true, ctrlKey: true }), false)).toBe('Mod+Shift+Enter');
  });
});

describe('what is forwarded', () => {
  const k = (o: Partial<KeyboardEvent>, typing: boolean) => keyMessage(ev(o), typing);
  it('carries the keydown fields', () => {
    expect(k({ key: 'b', code: 'KeyB', ctrlKey: true }, true)).toEqual({ key: 'b', code: 'KeyB', ctrl: true, meta: false, alt: false, shift: false, typing: true });
  });
  it('while typing, only Ctrl or Meta chords', () => {
    expect(forwardable(k({ key: 'x' }, true))).toBe(false);
    expect(forwardable(k({ key: 'ArrowUp' }, true))).toBe(false);
    expect(forwardable(k({ key: 'b', ctrlKey: true }, true))).toBe(true);
    expect(forwardable(k({ key: 'b', metaKey: true }, true))).toBe(true);
    expect(forwardable(k({ key: 'x', altKey: true }, true))).toBe(false);
  });
  it('outside text, every key but a bare modifier or a composition', () => {
    expect(forwardable(k({ key: 'g' }, false))).toBe(true);
    expect(forwardable(k({ key: 'Control', ctrlKey: true }, false))).toBe(false);
    expect(forwardable(k({ key: 'g' }, false), true)).toBe(false);
  });
  it('knows a text area', () => {
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('the writer\'s commands', () => {
  const ids = (l: ReturnType<typeof writerCommands>) => l.map((c) => c.id);
  it('are the writing tools, the first three in the ring', () => {
    const l = writerCommands({ reading: false, viewing: false });
    expect(ids(l).slice(0, 5)).toEqual(['save', 'proofread', 'shrink', 'marks', 'find-notes']);
    expect(l.filter((c) => c.ring).map((c) => c.id)).toEqual(['save', 'proofread', 'shrink']);
    expect(l.find((c) => c.id === 'back-to-reading')?.key).toBeUndefined();
  });
  it('are valid for zenbot, with Mod chords and none of its own keys', () => {
    const l = writerCommands({ reading: false, viewing: false });
    expect(cleanCommands(l)).toEqual(l);
    const keys = l.map((c) => c.key).filter((k): k is string => !!k);
    expect(keys.every((k) => k.startsWith('Mod+'))).toBe(true);
    expect(keys.filter((k) => ['Mod+k', 'Mod+.', 'Mod+\\', 'Mod+Shift+\\', '?', 'Escape', 'g'].includes(k))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('shrink to leaving in a closed version, and to nothing while reading', () => {
    expect(ids(writerCommands({ reading: false, viewing: true }))).toEqual(['open-note', 'back-to-reading']);
    expect(writerCommands({ reading: true, viewing: false })).toEqual([]);
  });
});

describe('cleanCommands', () => {
  it('drops bad or repeated ids, cuts titles, keeps 30', () => {
    const l = cleanCommands([
      { id: 'ok', title: 'x'.repeat(80) }, { id: 'Bad Id', title: 'no' }, { id: 'ok', title: 'again' }, { id: '', title: 'empty' },
      ...Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, title: 'c' })),
    ]);
    expect(l).toHaveLength(30);
    expect(l[0].title).toHaveLength(60);
    expect(l.map((c) => c.id)).not.toContain('Bad Id');
  });
});

describe('the bridge', () => {
  it('sends the commands once, again when they change, and hears commands and focus', () => {
    const send = vi.fn();
    const b = zenBridge(send);
    b.host.commands([{ id: 'save', title: 'Save', key: 'Mod+s' }]);
    b.host.commands([{ id: 'save', title: 'Save', key: 'Mod+s' }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('zen/commands', { commands: [{ id: 'save', title: 'Save', key: 'Mod+s' }] });
    b.host.commands([]);
    expect(send).toHaveBeenLastCalledWith('zen/commands', { commands: [] });
    const run = vi.fn();
    const focus = vi.fn();
    const off = b.host.onCommand(run);
    b.host.onFocus(focus);
    b.received('zen/command', { id: 'save' });
    b.received('zen/command', {});
    b.received('zen/focus', { focused: true });
    b.received('zen/focus', { focused: 'yes' });
    b.received('ui/other', { id: 'save' });
    expect(run.mock.calls).toEqual([['save']]);
    expect(focus.mock.calls).toEqual([[true]]);
    off();
    b.received('zen/command', { id: 'save' });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('knows a declared shortcut', () => {
    const b = zenBridge(() => {});
    b.host.commands([{ id: 'save', title: 'Save', key: 'Mod+s' }]);
    const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
    expect(b.isShortcut(ev({ key: 's', ctrlKey: !mac, metaKey: mac }))).toBe(true);
    expect(b.isShortcut(ev({ key: 'x', ctrlKey: !mac, metaKey: mac }))).toBe(false);
  });
});

describe('forwardKeys', () => {
  afterEach(() => vi.useRealTimers());
  function run(e: Record<string, unknown>, active = true, declared = true) {
    vi.useFakeTimers();
    const send = vi.fn();
    const b = zenBridge(send);
    if (declared) b.host.commands([{ id: 'save', title: 'Save', key: 'Mod+s' }]);
    send.mockClear();
    let listener: (e: KeyboardEvent) => void = () => {};
    forwardKeys(b, () => active, { addEventListener: (_t: string, fn: unknown) => { listener = fn as typeof listener; } } as never);
    const event = { ...ev(), defaultPrevented: false, isComposing: false, target: { tagName: 'DIV', isContentEditable: true }, preventDefault() { this.defaultPrevented = true; }, ...e };
    listener(event as unknown as KeyboardEvent);
    return { send, event, flush: () => vi.runAllTimers() };
  }
  const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
  const mod = mac ? { metaKey: true } : { ctrlKey: true };

  it('forwards a Mod chord typed in the editor, after the other handlers', () => {
    const { send, flush } = run({ key: 'b', code: 'KeyB', ...mod });
    expect(send).not.toHaveBeenCalled();
    flush();
    expect(send).toHaveBeenCalledWith('zen/key', expect.objectContaining({ key: 'b', typing: true }));
  });
  it('drops a key another handler used, and plain typing', () => {
    const used = run({ key: 'z', ...mod });
    used.event.defaultPrevented = true;
    used.flush();
    expect(used.send).not.toHaveBeenCalled();
    const typed = run({ key: 'x' });
    typed.flush();
    expect(typed.send).not.toHaveBeenCalled();
  });
  it('holds back a declared shortcut from the browser, and still forwards it', () => {
    const { send, event, flush } = run({ key: 's', code: 'KeyS', ...mod });
    expect(event.defaultPrevented).toBe(true);
    flush();
    expect(send).toHaveBeenCalledWith('zen/key', expect.objectContaining({ key: 's' }));
  });
  it('leaves an undeclared key alone, and does nothing outside zenbot', () => {
    const { event } = run({ key: 'b', ...mod });
    expect(event.defaultPrevented).toBe(false);
    const off = run({ key: 'b', ...mod }, false);
    off.flush();
    expect(off.send).not.toHaveBeenCalled();
  });
});
