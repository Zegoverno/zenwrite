// A note's versions. One version is open at a time: the note file itself, saved as you type.
// Closing it (with a changelog line) freezes a copy; editing again opens the next one.
//
//   .versions/<note path>/v1.md, v2.md, ...   each closed version, the whole file
//   .versions/<note path>/index.json          [{ n, date, by, log }]
//
// The folder is hidden, so Obsidian and the note list leave it out; Git syncs it with the notes.
// A note that had no versions yet gets its text as it was frozen as v1 before its first change.
// The open version is the file when it differs from the last closed copy (ignoring which
// alternative the editor left showing, which is not a change to the text).
//
// Pure: the folder is reached through `Io`, so the same code serves the MCP server (Node's
// files) and the standalone app (a folder the browser was given).

import { parseNote, serializeNote } from './note.ts';
import { VERSIONS_DIR } from './paths.ts';

export interface Io {
  /** The file's text, or null when it does not exist. */
  read(rel: string): Promise<string | null>;
  /** Writes the file whole (atomically where the platform allows), creating its folders. */
  write(rel: string, text: string): Promise<void>;
}

export interface Version {
  n: number;
  date: string;
  /** `me`: closed by the writer; `agent`: closed by an agent or the AI on their behalf. */
  by: 'me' | 'agent';
  log: string;
}

export interface VersionState {
  versions: Version[];
  /** The newest closed version, 0 when there is none. */
  current: number;
  /** True when the file has changes since that version: the open version is current + 1. */
  open: boolean;
}

export class VersionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const dirOf = (rel: string) => `${VERSIONS_DIR}/${rel}`;
const fileOf = (rel: string, n: number) => `${dirOf(rel)}/v${n}.md`;
const indexOf = (rel: string) => `${dirOf(rel)}/index.json`;

/** The text as far as versions care: without which alternative the editor left showing. */
const same = (a: string, b: string) => a.replace(/"showing":\d+,/g, '') === b.replace(/"showing":\d+,/g, '');

const LEGACY: Record<string, 'me' | 'agent'> = { ze: 'me', owner: 'me', zenbot: 'agent', me: 'me', agent: 'agent' };

/** The closed versions; null when the note has never been versioned (no index yet). */
async function index(io: Io, rel: string): Promise<Version[] | null> {
  const raw = await io.read(indexOf(rel));
  if (raw === null) return null;
  // A broken index stops here rather than be overwritten: it is the note's history.
  const v = JSON.parse(raw);
  if (!Array.isArray(v)) throw new Error(`broken version index for ${rel}`);
  return v.map((x) => ({ ...x, by: LEGACY[x.by] ?? 'me' }));
}

const list = async (io: Io, rel: string): Promise<Version[]> => (await index(io, rel)) ?? [];

export async function readVersion(io: Io, rel: string, n: number): Promise<string | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  return io.read(fileOf(rel, n));
}

export async function state(io: Io, rel: string, text: string | null): Promise<VersionState> {
  const versions = await index(io, rel);
  // Never versioned: the file as it is counts as v1, closed (its first change freezes it).
  if (versions === null) return { versions: [], current: text === null ? 0 : 1, open: false };
  const current = versions.length ? versions[versions.length - 1].n : 0;
  // A note made here starts as v1, open, until it is first closed.
  if (!current) return { versions, current, open: text !== null };
  const last = await readVersion(io, rel, current);
  return { versions, current, open: text !== null && (last === null || !same(last, text)) };
}

async function record(io: Io, rel: string, text: string, v: Version) {
  await io.write(fileOf(rel, v.n), text);
  const versions = await list(io, rel);
  versions.push(v);
  await io.write(indexOf(rel), JSON.stringify(versions, null, 1) + '\n');
}

const today = () => new Date().toISOString().slice(0, 10);

/** Before a note's first change: freeze it as it is, as v1. A new note starts versioned, v1 open. */
export async function baseline(io: Io, rel: string, text: string | null, date = today()) {
  if ((await index(io, rel)) !== null) return;
  if (text === null) return void (await io.write(indexOf(rel), '[]\n'));
  await record(io, rel, text, { n: 1, date, by: 'me', log: 'As it was before versions' });
}

/** The file with a changelog line added at the end of its changelog (made when missing). */
export function withLogLine(text: string, line: string): string {
  const note = parseNote(text);
  const log = note.changelog ? note.changelog.replace(/\s+$/, '') + '\n' : '## Changelog\n\n';
  return serializeNote({ ...note, changelog: `${log}- ${line}\n` });
}

/** Closes the open version: adds its changelog line to the file and freezes it. */
export async function close(io: Io, rel: string, text: string, log: string, by: 'me' | 'agent', date = today()): Promise<string> {
  const s = await state(io, rel, text);
  if (!s.open) throw new VersionError(400, 'nothing to close: no changes since the last version');
  const words = log.trim().replace(/\s+/g, ' ');
  if (!words) throw new VersionError(400, 'a version needs a changelog line');
  const n = s.current + 1;
  const out = withLogLine(text, `${date} — v${n}: ${words}${by === 'agent' ? ' (agent)' : ''}`);
  await record(io, rel, out, { n, date, by, log: words });
  return out;
}

/** A new open version that starts from version n, keeping today's changelog. */
export async function branch(io: Io, rel: string, text: string, n: number): Promise<string> {
  const s = await state(io, rel, text);
  if (s.open) throw new VersionError(400, `close v${s.current + 1} first`);
  const old = await readVersion(io, rel, n);
  if (old === null) throw new VersionError(404, `no version ${n}`);
  return serializeNote({ ...parseNote(old), changelog: parseNote(text).changelog });
}
