import { expect, it } from 'vitest';
import { cacheVersion } from '../shells/web/sw-version.ts';

it('refreshes the offline cache for same-length public file edits', () => {
  const files: Record<string, Uint8Array> = { 'index.html': Buffer.from('old'), 'manifest.webmanifest': Buffer.from('one') };
  const version = (names = Object.keys(files)) => cacheVersion(names, (f) => files[f]);
  const before = version();
  expect(version(Object.keys(files).reverse())).toBe(before);
  files['manifest.webmanifest'] = Buffer.from('two');
  expect(version()).not.toBe(before);
  const edited = version();
  files['renamed.html'] = files['index.html'];
  delete files['index.html'];
  expect(version()).not.toBe(edited);
});
