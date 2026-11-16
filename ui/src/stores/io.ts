// A Store over a folder reached through `Io` (the same core logic the MCP server uses), for the
// standalone app: a folder the browser was given, or memory in tests.

import { Notes } from '../../../core/notes.ts';
import type { Io } from '../../../core/versions.ts';
import type { Store } from '../lib/ports.ts';

export function ioStore(label: string, io: Io, files: () => Promise<string[]>, canVersion = true): Store {
  const notes = new Notes(io, label);
  return {
    label,
    canVersion,
    files,
    read: (p) => notes.read(p),
    write: (p, text, base) => notes.save(p, text, base),
    versions: (p) => notes.state(p),
    version: (p, n) => notes.version(p, n),
    close: (p, base, log) => notes.close(p, log, 'me', base),
    branch: (p, base, n) => notes.branch(p, n, base),
  };
}

/** A folder in memory: `files` maps path to text. For tests and the e2e hook. */
export function memoryStore(files: Record<string, string> = {}, label = 'Memory') {
  const data = new Map(Object.entries(files));
  const io: Io = {
    read: async (rel) => data.get(rel) ?? null,
    write: async (rel, text) => void data.set(rel, text),
  };
  const list = async () => [...data.keys()].filter((f) => !f.startsWith('.') && f.endsWith('.md')).sort();
  return { store: ioStore(label, io, list), data };
}
