// Include file names and bytes: same-length edits to unhashed public files must refresh the cache.
import { createHash } from 'node:crypto';

export function cacheVersion(files: string[], read: (file: string) => Uint8Array): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    const bytes = read(file);
    hash.update(JSON.stringify([file, bytes.byteLength]) + '\n');
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0, 16);
}
