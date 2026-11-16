// A note's path: relative to the folder zenwrite may touch, in `/` form. The checks that need
// no disk live here (the server adds the symlink check, the browser has no symlinks to follow).

export class PathError extends Error {}

/** The path's segments, or a PathError. Markdown only; no `..`, no absolute path, no dot folders. */
export function checkNotePath(rel: unknown): string[] {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new PathError('bad path');
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) throw new PathError('bad path: it must be relative');
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) throw new PathError('bad path');
  if (!rel.toLowerCase().endsWith('.md')) throw new PathError('only Markdown files');
  return parts;
}

/** The folder where a note's closed versions live, inside the files folder (a dot folder). */
export const VERSIONS_DIR = '.versions';
