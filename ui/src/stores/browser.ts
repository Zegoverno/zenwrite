// The standalone app's storage: a folder opened with the File System Access API (notes and their
// `.versions` live in it, so any sync tool or Git sees them), or, where the browser has no such
// API, one file opened with <input type=file> and saved by download (no versions).

import type { Io } from '../../../core/versions.ts';
import { ioStore, memoryStore } from './io.ts';
import type { Store } from '../lib/ports.ts';

export const hasFolderAccess = () => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

type Dir = FileSystemDirectoryHandle;

async function dirOf(root: Dir, rel: string, create: boolean): Promise<{ dir: Dir; name: string } | null> {
  const parts = rel.split('/');
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) {
    try {
      dir = await dir.getDirectoryHandle(p, { create });
    } catch {
      return null;
    }
  }
  return { dir, name };
}

/** `Io` over a directory handle. A writable stream swaps its file in when closed, so a crash keeps the old text. */
export function handleIo(root: Dir): Io {
  return {
    async read(rel) {
      const at = await dirOf(root, rel, false);
      if (!at) return null;
      try {
        return await (await (await at.dir.getFileHandle(at.name)).getFile()).text();
      } catch {
        return null;
      }
    },
    async write(rel, text) {
      const at = (await dirOf(root, rel, true))!;
      const w = await (await at.dir.getFileHandle(at.name, { create: true })).createWritable();
      try {
        await w.write(text);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => {});
        throw e;
      }
    },
  };
}

async function listFolder(root: Dir, limit = 5000): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: Dir, rel: string) {
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (name.startsWith('.') || name === 'node_modules' || out.length >= limit) continue;
      const r = rel ? `${rel}/${name}` : name;
      if (h.kind === 'directory') await walk(h as Dir, r);
      else if (name.toLowerCase().endsWith('.md')) out.push(r);
    }
  }
  await walk(root, '');
  return out.sort((a, b) => a.localeCompare(b));
}

export const folderStore = (root: Dir): Store => ioStore(root.name, handleIo(root), () => listFolder(root));

export async function pickFolder(): Promise<Dir> {
  return (globalThis as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker({ mode: 'readwrite', id: 'zenwrite-notes' });
}

// The last folder is remembered (its handle, in IndexedDB) so reopening asks only for permission.
const DB = 'zenwrite', TABLE = 'handles';
const db = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(TABLE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export async function rememberFolder(h: Dir | null) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const t = d.transaction(TABLE, 'readwrite');
      h ? t.objectStore(TABLE).put(h, 'folder') : t.objectStore(TABLE).delete('folder');
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch { /* private mode: the folder is just not remembered */ }
}
export async function rememberedFolder(): Promise<Dir | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction(TABLE).objectStore(TABLE).get('folder');
      r.onsuccess = () => res((r.result as Dir) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
/** Asks for permission on a remembered folder; must run from a click. */
export async function allowed(h: Dir): Promise<boolean> {
  const p = h as unknown as { requestPermission(o: object): Promise<string> };
  return (await p.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** One file, for browsers without folder access: kept in memory while the page is open; saving it is a download (the Download button, Ctrl+S). */
export function fileStore(name: string, text: string | null): Store & { path: string } {
  const { store, data } = memoryStore(text === null ? {} : { [name]: text }, name);
  return {
    ...store,
    canVersion: false,
    path: name,
    versions: async () => ({ versions: [], current: 0, open: false }),
    download(p) {
      const url = URL.createObjectURL(new Blob([data.get(p) ?? ''], { type: 'text/markdown' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: p.split('/').pop() });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  };
}
