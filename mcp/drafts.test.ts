import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Drafts, MAX_DRAFT } from './drafts.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'zw-drafts-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Drafts', () => {
  it('keeps, returns and drops a draft per note', async () => {
    const d = new Drafts(dir);
    expect(await d.get('a/One.md')).toBeNull();
    await d.put('a/One.md', '# One\n\nhalf', 'h1');
    await d.put('Two.md', 'other', null);
    expect(await d.get('a/One.md')).toMatchObject({ text: '# One\n\nhalf', base: 'h1' });
    expect(await d.get('Two.md')).toMatchObject({ text: 'other', base: null });
    await d.put('a/One.md', 'newer', 'h1');
    expect((await d.get('a/One.md'))?.text).toBe('newer');
    await d.drop('a/One.md');
    expect(await d.get('a/One.md')).toBeNull();
    expect(await d.get('Two.md')).not.toBeNull();
    await d.drop('a/One.md'); // dropping nothing is fine
  });

  it('names files by a hash, never by the note path, and leaves no temporary files', async () => {
    const d = new Drafts(dir);
    await d.put('../x/Etc.md', 'x', null);
    const files = await readdir(path.join(dir, 'drafts'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{40}\.json$/);
  });

  it('refuses a draft that is too large', async () => {
    await expect(new Drafts(dir).put('Big.md', 'x'.repeat(MAX_DRAFT + 1), null)).rejects.toThrow(/too large/);
  });
});
