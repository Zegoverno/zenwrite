// The two small interfaces that let one UI run anywhere (ADR 0003): where notes live (`Store`)
// and who answers the AI (`Ai`). The MCP App fills them with the plugin's tools, the standalone
// app with a folder the browser was given (and no AI yet), tests with memory.

import type { Changed } from '../../../core/notes.ts';
import type { Version, VersionState } from '../../../core/versions.ts';
import type { Fix, Proposal, SuggestRequest } from '../../../core/ai.ts';
import type { ZenHost } from './zen.ts';

export { Conflict } from '../../../core/notes.ts';
export type { Changed, Version, VersionState, Fix, Proposal, SuggestRequest };

export interface Store {
  /** What the app shows as the place: a folder's name, or the note's file. */
  label: string;
  /** False when versions cannot be kept (a single file opened or saved by download). */
  canVersion: boolean;
  /** How often to look for changes made elsewhere, in ms (default 4000). */
  pollMs?: number;
  files(): Promise<string[]>;
  /** The note, or null when it does not exist (yet). */
  read(path: string): Promise<{ text: string; hash: string } | null>;
  /** Writes against the hash the page last read (null: create); throws Conflict when the file moved on. */
  write(path: string, text: string, base: string | null): Promise<{ hash: string }>;
  versions(path: string): Promise<VersionState>;
  version(path: string, n: number): Promise<string | null>;
  close(path: string, base: string, log: string): Promise<Changed>;
  branch(path: string, base: string, n: number): Promise<Changed>;
  /** Unsaved text kept for a note, so closing the editor loses nothing (where the host edits a note
   *  without saving as you type). `base` is the note's hash when the draft began. */
  drafts?: {
    get(path: string): Promise<{ text: string; base: string | null } | null>;
    put(path: string, text: string, base: string | null): Promise<void>;
    drop(path: string): Promise<void>;
  };
  /** Only where saving means a download (a single file opened without folder access). */
  download?(path: string): void;
}

export interface Ai {
  /** Why the AI is off here, shown with the first refusal; undefined when it may answer. */
  off?: string;
  /** `model`: which model wrote them, when the host says (kept on each AI variant). */
  alternatives(req: SuggestRequest): Promise<{ alternatives: string[]; model?: string }>;
  check(text: string): Promise<Fix[]>;
  marks(text: string): Promise<Fix[]>;
  shrink(text: string): Promise<Fix[]>;
  findNotes(path: string, text: string): Promise<Proposal[]>;
  changelog(path: string): Promise<string>;
}

/** What the page asks of the place it runs in. */
export interface Host {
  /** A web link. */
  openUrl(url: string): void;
  /** A link to a file that is not a note (the host decides what opens it). */
  openFile(path: string): void;
  /** Another note, handed to the host to open (zenbot sends it to the note's opener, in the mode asked). Resolves
   *  false when the host did not take it, and the app opens it itself. */
  openNote?(path: string, mode?: 'read' | 'edit'): Promise<boolean>;
  /** The note now open, for hosts that listen (a chat knowing what you write). */
  noteOpened?(path: string, words: number): void;
  /** zenbot's keyboard model (commands, keys, focus), when the page runs inside it; see lib/zen.ts. */
  zen?: ZenHost;
}

/** An Ai that is switched off, with the reason. */
export function noAi(reason: string): Ai {
  const off = async (): Promise<never> => { throw new Error(reason); };
  return { off: reason, alternatives: off, check: off, marks: off, shrink: off, findNotes: off, changelog: off };
}
