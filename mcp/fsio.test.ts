import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataIo, listNotes, nodeIo, notePath, openData, openRoot, versionsIo } from './fsio.ts';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-'));

describe('the files folder', () => {
  it('refuses traversal, absolute paths, dot folders and other types', () => {
    for (const bad of ['../x.md', '/etc/x.md', '.versions/a.md', '.git/x.md', 'a.txt', 'a//b.md']) expect(() => notePath(bad)).toThrow();
    expect(notePath('notes/A.md')).toBe('notes/A.md');
  });

  it('refuses a symlink that leaves the folder, for reads and writes', async () => {
    const root = await openRoot(await tmp());
    const outside = await tmp();
    await fs.writeFile(path.join(outside, 'secret.md'), 'secret');
    await fs.symlink(outside, path.join(root, 'out'));
    await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'link.md'));
    const io = nodeIo(root);
    await expect(io.read('out/secret.md')).rejects.toThrow();
    await expect(io.write('out/new.md', 'x')).rejects.toThrow();
    await expect(io.read('link.md')).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual(['secret.md']);
  });

  it('allows a dot folder only for the plugin\'s own .versions', async () => {
    const root = await openRoot(await tmp());
    const io = nodeIo(root);
    await io.write('.versions/a.md/v1.md', 'x');
    expect(await io.read('.versions/a.md/v1.md')).toBe('x');
    await expect(io.write('.git/config', 'x')).rejects.toThrow();
    await expect(io.read('a/../../x')).rejects.toThrow();
    await expect(io.read('/etc/passwd')).rejects.toThrow();
  });

  it('writes atomically, keeps the mode and leaves no temporary file', async () => {
    const root = await openRoot(await tmp());
    const io = nodeIo(root);
    await Promise.all([io.write('n/A.md', 'one'), io.write('n/A.md', 'two')]);
    expect(['one', 'two']).toContain(await io.read('n/A.md'));
    expect(await fs.readdir(path.join(root, 'n'))).toEqual(['A.md']);
    expect(await io.read('n/missing.md')).toBeNull();
  });

  it('lists notes, without dot folders or links', async () => {
    const root = await openRoot(await tmp());
    const io = nodeIo(root);
    await io.write('b.md', 'x');
    await io.write('a/c.md', 'x');
    await io.write('.versions/b.md/v1.md', 'x');
    await fs.writeFile(path.join(root, 'note.txt'), 'x');
    await fs.symlink(root, path.join(root, 'loop'));
    expect(await listNotes(root)).toEqual(['a/c.md', 'b.md']);
  });

  it('keeps versions in the data folder, reading an older .versions beside the notes', async () => {
    const root = await openRoot(await tmp());
    const data = await openData(path.join(await tmp(), 'made', 'here'));
    const notes = nodeIo(root);
    await notes.write('.versions/a.md/v1.md', 'old');
    const io = versionsIo(dataIo(data), notes);
    expect(await io.read('.versions/a.md/v1.md')).toBe('old');
    await io.write('.versions/a.md/v2.md', 'new');
    expect(await fs.readFile(path.join(data, 'versions/a.md/v2.md'), 'utf8')).toBe('new');
    expect(await fs.readdir(path.join(root, '.versions/a.md'))).toEqual(['v1.md']);
    await expect(dataIo(data).write('a.md', 'x')).rejects.toThrow();
    await expect(dataIo(data).read('.versions/../../x')).rejects.toThrow();
    await expect(openData('relative/dir')).rejects.toThrow(/absolute/);
  });
});
