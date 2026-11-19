// Drafts: the text a writer has typed but not saved, kept in the plugin's data folder
// (`ZEN_PLUGIN_DATA`/drafts) so it survives the app being closed and reopened. The app runs in a
// sandboxed frame without storage of its own, so the server keeps them. One file per note, named by
// the hash of its path (the path itself never becomes a file name); a draft remembers the hash of
// the note it was written against, so a note that changed since is noticed when it is saved.
// A draft is never the note: nothing here touches the notes folder.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PathError } from '../core/paths.ts';

export interface Draft {
  text: string;
  /** The hash of the note when the draft began (null: a new note). */
  base: string | null;
  /** When it was last kept, ms since the epoch. */
  at: number;
}

/** The most a draft may hold: a note is text, and this folder is not a place for anything else. */
export const MAX_DRAFT = 4 * 1024 * 1024;

export class Drafts {
  private dir: string;
  constructor(realData: string) {
    this.dir = path.join(realData, 'drafts');
  }

  private file(note: string): string {
    return path.join(this.dir, `${createHash('sha256').update(note).digest('hex').slice(0, 40)}.json`);
  }

  async get(note: string): Promise<Draft | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(note), 'utf8');
    } catch {
      return null;
    }
    try {
      const d = JSON.parse(raw) as { path?: unknown; text?: unknown; base?: unknown; at?: unknown };
      if (d.path !== note || typeof d.text !== 'string') return null;
      return { text: d.text, base: typeof d.base === 'string' ? d.base : null, at: typeof d.at === 'number' ? d.at : 0 };
    } catch {
      return null;
    }
  }

  async put(note: string, text: string, base: string | null): Promise<void> {
    if (Buffer.byteLength(text) > MAX_DRAFT) throw new PathError('the draft is too large to keep');
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.file(note);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ path: note, text, base, at: Date.now() }), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async drop(note: string): Promise<void> {
    await fs.rm(this.file(note), { force: true });
  }
}
