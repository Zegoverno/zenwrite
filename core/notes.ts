// Reading and saving notes safely, and their versions, over any folder (`Io`). Shared by the MCP
// server (Node's files) and the standalone app (a folder the browser was given), so the rules are
// the same everywhere:
//
// - a save names the hash of the text it was based on (`base`, null to create a note); if the
//   file has moved on since, nothing is written and the caller gets a Conflict with what is there;
// - one read-check-write at a time per note;
// - before a note's first change, its text is frozen as v1 (`versions.baseline`).
//
// Versions may live elsewhere than the notes (`versionsIo`): the MCP server keeps them in the
// plugin's data folder, the standalone app beside the notes.

import { hashText } from './hash.ts';
import * as versions from './versions.ts';
import type { Io, VersionState } from './versions.ts';

export class Conflict extends Error {
  /** The file as it is now (null: it is gone). */
  text: string | null;
  hash: string | null;
  constructor(text: string | null, hash: string | null) {
    super('changed on disk');
    this.text = text;
    this.hash = hash;
  }
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `f` once every earlier call for the same key is done: one read-check-write at a time per note. */
export function locked<T>(key: string, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(f, f);
  const done = run.catch(() => {});
  queues.set(key, done);
  void done.then(() => queues.get(key) === done && queues.delete(key));
  return run;
}

export interface Changed extends VersionState {
  text: string;
  hash: string;
}

export class Notes {
  readonly io: Io;
  /** Where closed versions are kept (paths under `.versions/`); the notes' own folder by default. */
  readonly vio: Io;
  /** Distinguishes two folders that hold a note of the same name, for the lock. */
  readonly scope: string;

  constructor(io: Io, scope = '', versionsIo?: Io) {
    this.io = io;
    this.vio = versionsIo ?? io;
    this.scope = scope;
  }

  private key = (rel: string) => `${this.scope}\0${rel}`;

  async read(rel: string): Promise<{ text: string; hash: string } | null> {
    const text = await this.io.read(rel);
    return text === null ? null : { text, hash: await hashText(text) };
  }

  /** Writes the note if the file is still what `base` says (null: it must not exist yet). */
  save(rel: string, text: string, base: string | null): Promise<{ hash: string }> {
    return locked(this.key(rel), async () => {
      const current = await this.io.read(rel);
      const now = current === null ? null : await hashText(current);
      if (now !== base) throw new Conflict(current, now);
      if (current !== text) await versions.baseline(this.vio, rel, current);
      await this.io.write(rel, text);
      return { hash: await hashText(text) };
    });
  }

  async state(rel: string): Promise<VersionState> {
    return versions.state(this.vio, rel, await this.io.read(rel));
  }

  version(rel: string, n: number): Promise<string | null> {
    return versions.readVersion(this.vio, rel, n);
  }

  /** Closes the open version with a changelog line. `base`, when given, must be the file's hash. */
  close(rel: string, log: string, by: 'me' | 'agent', base?: string | null): Promise<Changed> {
    return locked(this.key(rel), async () => {
      const current = await this.io.read(rel);
      if (current === null) throw new versions.VersionError(404, 'not found');
      const now = await hashText(current);
      if (base !== undefined && base !== now) throw new Conflict(current, now);
      const out = await versions.close(this.vio, rel, current, log, by);
      await this.io.write(rel, out);
      return { text: out, hash: await hashText(out), ...(await versions.state(this.vio, rel, out)) };
    });
  }

  /** Starts a new open version from closed version n; refuses while a version is open. */
  branch(rel: string, n: number, base?: string | null): Promise<Changed> {
    return locked(this.key(rel), async () => {
      const current = await this.io.read(rel);
      if (current === null) throw new versions.VersionError(404, 'not found');
      const now = await hashText(current);
      if (base !== undefined && base !== now) throw new Conflict(current, now);
      const out = await versions.branch(this.vio, rel, current, n);
      await this.io.write(rel, out);
      return { text: out, hash: await hashText(out), ...(await versions.state(this.vio, rel, out)) };
    });
  }
}
