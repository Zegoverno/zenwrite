// The editor's view of its Store and Ai: the calls it makes, with the shapes it wants.

import { Conflict, type Ai, type Changed, type Fix, type Proposal, type Store, type SuggestRequest, type VersionState, type Version } from './ports.ts';

export { Conflict };
export type { Version, VersionState, Fix as FixProposal, Proposal as NoteProposal };
export type FixKind = Fix['kind'];

export function makeApi(store: Store, ai: Ai) {
  return {
    changelog: async (path: string) => ({ log: await ai.changelog(path) }),
    findNotes: async (path: string, text: string) => ({ notes: await ai.findNotes(path, text) }),
    check: async (text: string) => ({ fixes: await ai.check(text) }),
    shrink: async (text: string) => ({ fixes: await ai.shrink(text) }),
    marks: async (text: string) => ({ fixes: await ai.marks(text) }),
    suggest: (req: SuggestRequest) => ai.alternatives(req),
    versions: (path: string): Promise<VersionState> => store.versions(path),
    version: async (path: string, n: number) => {
      const text = await store.version(path, n);
      if (text === null) throw new Error('no such version');
      return { text };
    },
    close: (path: string, base: string, log: string): Promise<Changed> => store.close(path, base, log),
    branch: (path: string, base: string, n: number): Promise<Changed> => store.branch(path, base, n),
    read: async (path: string) => {
      const n = await store.read(path);
      if (!n) throw new Error('not found');
      return n;
    },
    files: async () => ({ files: await store.files() }),
    write: (path: string, text: string, base: string | null) => store.write(path, text, base),
  };
}
