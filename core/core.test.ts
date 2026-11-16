import { describe, expect, it } from 'vitest';
import * as ai from './ai.ts';
import { checkNotePath } from './paths.ts';
import { Conflict, locked, Notes } from './notes.ts';
import { searchDocs } from './search.ts';
import * as versions from './versions.ts';
import type { Io } from './versions.ts';
import { hashText } from './hash.ts';
import { parseNote } from './note.ts';

function memory(files: Record<string, string> = {}) {
  const data = new Map(Object.entries(files));
  const io: Io = { read: async (r) => data.get(r) ?? null, write: async (r, t) => void data.set(r, t) };
  return { io, data };
}

describe('paths', () => {
  it('accepts a relative Markdown path and refuses the rest', () => {
    expect(checkNotePath('ideas/A.md')).toEqual(['ideas', 'A.md']);
    for (const bad of ['../x.md', '/etc/x.md', 'C:\\x.md', '.versions/a.md', '.hidden/a.md', 'a/.b.md', 'a.txt', 'a//b.md', 'a/./b.md', '', 'a\0.md', 'a\\..\\b.md', 42]) {
      expect(() => checkNotePath(bad)).toThrow();
    }
  });
});

describe('hash', () => {
  it('tells two texts apart and is stable', async () => {
    expect(await hashText('a')).toBe(await hashText('a'));
    expect(await hashText('a')).not.toBe(await hashText('b'));
    expect(await hashText('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('versions', () => {
  it('baseline, open, close, and branch only when nothing is open', async () => {
    const { io } = memory();
    await versions.baseline(io, 'a.md', '# A\n\nOne.\n');
    expect(await versions.state(io, 'a.md', '# A\n\nOne.\n')).toMatchObject({ current: 1, open: false });
    const edited = '# A\n\nTwo.\n';
    expect((await versions.state(io, 'a.md', edited)).open).toBe(true);
    await expect(versions.branch(io, 'a.md', edited, 1)).rejects.toThrow(/close v2/);
    const closed = await versions.close(io, 'a.md', edited, 'second', 'me');
    expect(closed).toMatch(/## Changelog\n\n- \d{4}-\d\d-\d\d — v2: second\n/);
    expect(await versions.state(io, 'a.md', closed)).toMatchObject({ current: 2, open: false });
    expect(await versions.readVersion(io, 'a.md', 1)).toBe('# A\n\nOne.\n');
    const back = await versions.branch(io, 'a.md', closed, 1);
    expect(back).toContain('One.');
    expect(parseNote(back).changelog).toContain('v2: second');
  });

  it('a broken index stops instead of being overwritten', async () => {
    const { io } = memory({ '.versions/a.md/index.json': '{oops' });
    await expect(versions.state(io, 'a.md', 'x')).rejects.toThrow();
  });

  it('reads the older author names', async () => {
    const { io } = memory({ '.versions/a.md/index.json': '[{"n":1,"date":"2026-01-01","by":"zenbot","log":"x"}]' });
    expect((await versions.state(io, 'a.md', null)).versions[0].by).toBe('agent');
  });

  it('refuses to close with nothing changed or no line', async () => {
    const { io } = memory();
    await versions.baseline(io, 'a.md', '# A\n\nOne.\n');
    await expect(versions.close(io, 'a.md', '# A\n\nOne.\n', 'x', 'me')).rejects.toThrow(/nothing to close/);
    await expect(versions.close(io, 'a.md', '# A\n\nTwo.\n', '  ', 'me')).rejects.toThrow(/changelog line/);
  });
});

describe('notes', () => {
  it('saves against the hash it was based on and never over a changed file', async () => {
    const { io, data } = memory();
    const notes = new Notes(io);
    const created = await notes.save('a.md', '# A\n\nOne.\n', null);
    await expect(notes.save('a.md', 'again', null)).rejects.toBeInstanceOf(Conflict);
    const second = await notes.save('a.md', '# A\n\nTwo.\n', created.hash);
    data.set('a.md', '# A\n\nElsewhere.\n');
    const err = await notes.save('a.md', '# A\n\nThree.\n', second.hash).catch((e) => e);
    expect(err).toBeInstanceOf(Conflict);
    expect(err.text).toBe('# A\n\nElsewhere.\n');
    expect(data.get('a.md')).toBe('# A\n\nElsewhere.\n');
    // a note made here starts as v1, open: nothing is frozen until it is closed
    expect(await notes.version('a.md', 1)).toBeNull();
    expect(await notes.state('a.md')).toMatchObject({ current: 0, open: true });
    // an older note's first change freezes the text before it as v1
    data.set('b.md', '# B\n\nOld.\n');
    const b = await notes.read('b.md');
    await notes.save('b.md', '# B\n\nNew.\n', b!.hash);
    expect(await notes.version('b.md', 1)).toBe('# B\n\nOld.\n');
  });

  it('runs one write at a time per key', async () => {
    const order: string[] = [];
    const slow = (tag: string, ms: number) => locked('k', async () => {
      order.push(`${tag}+`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${tag}-`);
    });
    await Promise.all([slow('a', 20), slow('b', 0)]);
    expect(order).toEqual(['a+', 'a-', 'b+', 'b-']);
  });
});

describe('reading the AI answers', () => {
  it('fixes must name text that is in the note', () => {
    const note = 'This are fine.';
    const reply = 'Sure: {"fixes":[{"find":"This are","replace":"This is","kind":"grammar","why":"agreement"},{"find":"missing","replace":"x","kind":"spelling","why":""},{"find":"fine","replace":"fine","kind":"odd","why":""}]}';
    expect(ai.parseFixes(reply, note)).toEqual([{ find: 'This are', replace: 'This is', kind: 'grammar', why: 'agreement' }]);
  });

  it('cuts are shorter, found in the note, all of kind cut', () => {
    const note = 'It is really very good. We go.';
    const reply = '{"fixes":[{"find":" really very","replace":"","why":"filler"},{"find":"We go.","replace":"We all go now.","why":"longer"},{"find":"nope","replace":""}]}';
    expect(ai.parseFixes(reply, note, 'cut')).toEqual([{ find: ' really very', replace: '', kind: 'cut', why: 'filler' }]);
  });

  it('marks point at text in the note and change nothing', () => {
    const reply = '{"marks":[{"find":"It is","kind":"weak","why":"flat"},{"find":"nope","kind":"long"},{"find":"We go.","kind":"odd"}]}';
    expect(ai.parseMarks(reply, 'It is good. We go.')).toEqual([{ find: 'It is', replace: 'It is', kind: 'weak', why: 'flat' }]);
  });

  it('alternatives are trimmed, unquoted, new and on one line', () => {
    const r = { paragraph: 'A b.', target: 'b', scope: 'word' as const, existing: ['b', 'c'] };
    expect(ai.parseAlternatives('{"alternatives":["“d”"," b ","c","e\\nf","d"]}', r)).toEqual(['d']);
  });

  it('notes link only notes the search found', async () => {
    const docs = [{ path: 'ideas/Angels.md', text: 'Angels are pure spirits.' }, { path: 'Other.md', text: 'Nothing here.' }];
    const replies = [
      '{"search":["angels","spirits"]}',
      '{"notes":[{"text":"Backs the angels part.","page":"[[ideas/Angels]]","quote":"pure spirits"},{"text":"Made up.","page":"Nowhere"}]}',
    ];
    const prompts: string[] = [];
    const out = await ai.findNotes(async (_s, p) => (prompts.push(p), replies.shift()!), (q, n) => searchDocs(docs, q, n), { path: 'Piece.md', text: 'A piece about angels.' });
    expect(out.notes).toEqual([{ text: 'Backs the angels part.', page: 'Angels', quote: 'pure spirits' }]);
    expect(out.searched).toEqual(['angels', 'spirits']);
    expect(prompts[1]).toContain('[[ideas/Angels]]');
  });

  it('the changelog line is one plain line', async () => {
    const s = { versions: [], current: 1, open: true };
    const r = await ai.suggestLog(async () => '- v2: "added the intro"\nmore', '# A\n\nNew.\n', s, '# A\n');
    expect(r.log).toBe('added the intro');
    expect((await ai.suggestLog(async () => 'x', '# A', { ...s, open: false }, null)).log).toBe('');
  });

  it('refuses empty or huge input', async () => {
    await expect(ai.check(async () => '', '  ')).rejects.toBeInstanceOf(ai.AiRequestError);
    await expect(ai.shrink(async () => '', 'x'.repeat(60_001))).rejects.toBeInstanceOf(ai.AiRequestError);
  });
});

describe('search', () => {
  it('scores by title and by how many of the words a note holds', () => {
    const docs = [
      { path: 'a/Rivers.md', text: 'Water flows to the sea.' },
      { path: 'b/Sea.md', text: 'The sea is salt water.' },
      { path: 'c/Mountains.md', text: 'Rock.' },
    ];
    const hits = searchDocs(docs, 'sea water');
    expect(hits.map((h) => h.path)).toEqual(['b/Sea.md', 'a/Rivers.md']);
    expect(hits[0]).toMatchObject({ ref: 'b/Sea', title: 'Sea' });
    expect(searchDocs(docs, 'sea', 8, 'b/Sea.md').map((h) => h.path)).toEqual(['a/Rivers.md']);
    expect(searchDocs(docs, 'the and')).toEqual([]);
  });
});

describe('the note format', () => {
  it('reads older author names', () => {
    const meta = JSON.stringify({ version: 1, groups: [{ id: 'g', scope: 'word', anchor: 'big', occurrence: 0, active: 0, variants: [{ text: 'big', by: 'ze' }, { text: 'large', by: 'zenbot' }, { text: 'huge', by: 'owner' }] }] });
    const n = parseNote(`# T\n\nA big day.\n\n<!-- zen:alternatives\n${meta}\n-->\n`);
    expect(n.groups[0].variants.map((v) => v.by)).toEqual(['me', 'agent', 'me']);
  });
});
