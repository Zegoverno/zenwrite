// The folder zenwrite may touch (`ZEN_PLUGIN_FILES`), as Node sees it: paths kept inside it,
// atomic writes, a listing of its notes. Every path a tool takes goes through `notePath` first
// (relative, Markdown, no `..`, no absolute path, no dot folder); `nodeIo` then refuses anything
// that, once symlinks are followed, leaves the folder, and allows a dot folder only for the
// plugin's own `.versions`.
//
// Closed versions live in the plugin's data folder (`ZEN_PLUGIN_DATA`), under `versions/<note>/`
// (`dataIo`), so the notes folder only ever holds notes. Histories kept beside the notes in
// `.versions/` (the zenbot web writer's, or this plugin's without a data folder) are still read
// (`versionsIo`); new versions are written to the data folder.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkNotePath, PathError, VERSIONS_DIR } from '../core/paths.ts';
import type { Io } from '../core/versions.ts';

export { PathError };

/** The validated note path (same string back), or a PathError. */
export function notePath(rel: unknown): string {
  checkNotePath(rel);
  return rel as string;
}

/** The root, resolved; PathError when it is not a folder. */
export async function openRoot(dir: string): Promise<string> {
  const real = await fs.realpath(path.resolve(dir)).catch(() => null);
  if (!real || !(await fs.stat(real)).isDirectory()) throw new PathError(`not a folder: ${dir}`);
  return real;
}

const inside = (realRoot: string, real: string) => real === realRoot || real.startsWith(realRoot + path.sep);

/** The absolute path for `rel` under the (real) root, or a PathError. Symlinks that lead out are refused. */
async function resolveIn(realRoot: string, rel: string): Promise<string> {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel)) throw new PathError('bad path');
  const parts = rel.split('/');
  if (parts.some((p, i) => p === '' || p === '.' || p === '..' || p.includes('\\') || (p.startsWith('.') && !(i === 0 && p === VERSIONS_DIR)))) {
    throw new PathError('bad path');
  }
  const full = path.join(realRoot, rel);
  // The nearest folder that exists must be inside the root once symlinks are followed.
  for (let dir = path.dirname(full); ; dir = path.dirname(dir)) {
    const real = await fs.realpath(dir).catch(() => null);
    if (real !== null) {
      if (!inside(realRoot, real)) throw new PathError('bad path');
      break;
    }
    if (dir === realRoot || dir === path.dirname(dir)) break;
  }
  // The file itself, when it exists, must not be a link out.
  const real = await fs.realpath(full).catch(() => null);
  if (real !== null && !inside(realRoot, real)) throw new PathError('bad path');
  return full;
}

export function nodeIo(realRoot: string): Io {
  return {
    async read(rel) {
      const full = await resolveIn(realRoot, rel);
      try {
        return await fs.readFile(full, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    /** Through a temporary file and a rename, so a crash never leaves half a note; keeps its mode. */
    async write(rel, text) {
      const full = await resolveIn(realRoot, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      // mkdir may have followed a link made in between: check the folder once more.
      if (!inside(realRoot, await fs.realpath(path.dirname(full)))) throw new PathError('bad path');
      const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomBytes(4).toString('hex')}.tmp`);
      const mode = await fs.stat(full).then((s) => s.mode & 0o777, () => 0o644);
      try {
        await fs.writeFile(tmp, text, { mode, flag: 'wx' });
        await fs.rename(tmp, full);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
    },
  };
}

const SKIP = new Set(['node_modules']);

/** Every Markdown note under the root, sorted; dot folders and symlinks are left out. */
export async function listNotes(realRoot: string, limit = 5000): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name) || out.length >= limit) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(r);
    }
  }
  await walk(realRoot, '');
  return out.sort((a, b) => a.localeCompare(b));
}

/** The root of the plugin's data folder, made when missing; PathError when it cannot be. */
export async function openData(dir: string): Promise<string> {
  if (!path.isAbsolute(dir)) throw new PathError(`ZEN_PLUGIN_DATA must be an absolute path: ${dir}`);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  return openRoot(dir);
}

const VERSIONS_PREFIX = `${VERSIONS_DIR}/`;

/** Versions in the data folder: `.versions/<note>/…` is kept at `<data>/versions/<note>/…`. */
export function dataIo(realData: string): Io {
  const io = nodeIo(realData);
  const map = (rel: string) => {
    if (!rel.startsWith(VERSIONS_PREFIX)) throw new PathError('bad path');
    return `versions/${rel.slice(VERSIONS_PREFIX.length)}`;
  };
  return { read: async (rel) => io.read(map(rel)), write: async (rel, text) => io.write(map(rel), text) };
}

/** Writes go to `primary`; a file it does not have yet is read from `legacy` (read-only). */
export function versionsIo(primary: Io, legacy: Io): Io {
  return {
    async read(rel) {
      const own = await primary.read(rel);
      if (own !== null) return own;
      return legacy.read(rel).catch(() => null);
    },
    write: (rel, text) => primary.write(rel, text),
  };
}
