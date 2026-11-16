// What the AI is asked, and how its answers are read. No model and no I/O here: a `Complete`
// function (the MCP server gives one that samples the host's model) does the asking, so the same
// code is tested with a stub. Every answer is checked against the note, so a model that invents
// text or pages changes nothing: a fix must name words that are in the note, a note must link a
// page the search found.
//
// The instructions (what a good proofread is, what to mark) are the writing skills in `skills/`;
// the server reads them at every call and passes them in as `Instructions`, so what you teach
// them applies without a code change. The short fallbacks below do when a skill is missing. Only
// the answers' shapes are fixed here, because the page depends on them.

import { changelogEntries, parseNote, withoutGhosts } from './note.ts';
import type { Hit } from './search.ts';
import type { VersionState } from './versions.ts';

/** One completion: a system prompt and a prompt in, the model's text out. */
export type Complete = (system: string, prompt: string) => Promise<string>;

export interface Instructions {
  proofread?: string;
  marks?: string;
  shrink?: string;
  findNotes?: string;
  changelog?: string;
}

export class AiRequestError extends Error {}

/** The JSON object in a model's answer, or null. */
export function jsonIn(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// --- alternatives ----------------------------------------------------------------------------

export interface SuggestRequest {
  title?: string;
  /** The whole paragraph the target sits in. */
  paragraph: string;
  /** The text to rewrite, as it shows now. */
  target: string;
  scope: 'word' | 'sentence' | 'paragraph';
  /** Versions already written, so the AI doesn't repeat them. */
  existing?: string[];
  count?: number;
}

export const ALTERNATIVES_SYSTEM = `You help a writer find other ways to say one piece of their text.
You never rewrite anything else, and you never explain.
Keep the writer's meaning, voice, register and language (if the text is in Portuguese, answer in Portuguese).
Each alternative must drop in exactly where the original stands: same grammatical role, no surrounding words, no quotes around it.
Make the alternatives genuinely different from each other and from the versions already written; vary length and rhythm, and prefer plain, concrete words.
Answer with JSON only: {"alternatives": ["...", "..."]}`;

export function alternativesPrompt(r: SuggestRequest): string {
  const n = r.count ?? 3;
  const what = r.scope === 'word' ? 'word or phrase' : r.scope;
  const lines = [
    r.title ? `Note title: ${r.title}` : '',
    r.scope === 'paragraph' ? '' : `The paragraph, with the ${what} to replace between ⟦ and ⟧:\n${r.paragraph.replace(r.target, `⟦${r.target}⟧`)}`,
    `The ${what} to replace:\n${r.target}`,
    r.existing && r.existing.length > 1 ? `Versions already written (don't repeat them):\n${r.existing.map((e) => `- ${e}`).join('\n')}` : '',
    `Give ${n} alternatives for the ${what}.`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** The alternatives in a reply: the JSON object's list, trimmed, deduplicated, never the target. */
export function parseAlternatives(text: string, r: SuggestRequest): string[] {
  const list = jsonIn(text)?.alternatives;
  if (!Array.isArray(list)) return [];
  const seen = new Set([r.target.trim(), ...(r.existing ?? []).map((e) => e.trim())]);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const t = item.trim().replace(/^["“'‘⟦]+|["”'’⟧]+$/g, '').trim();
    if (!t || seen.has(t) || t.includes('\n')) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export async function alternatives(complete: Complete, r: SuggestRequest): Promise<{ alternatives: string[] }> {
  if (!r || typeof r.target !== 'string' || !r.target.trim() || typeof r.paragraph !== 'string') {
    throw new AiRequestError('target and paragraph are required');
  }
  if (r.target.length > 4000 || r.paragraph.length > 8000) throw new AiRequestError('too long');
  return { alternatives: parseAlternatives(await complete(ALTERNATIVES_SYSTEM, alternativesPrompt(r)), r) };
}

// --- check, marks, shrink --------------------------------------------------------------------

export type Mark = 'weak' | 'long' | 'filler';
export type Kind = 'spelling' | 'punctuation' | 'grammar' | 'clarity' | 'cut' | Mark;
const MARKS: Mark[] = ['weak', 'long', 'filler'];
const KINDS: Kind[] = ['spelling', 'punctuation', 'grammar', 'clarity'];

export interface Fix {
  /** The exact text to change, copied from the note, as short as makes it unique. */
  find: string;
  replace: string;
  kind: Kind;
  /** One short reason. */
  why: string;
}

const PROOFREAD = `You are a careful proofreader for a writer's own note. Propose small, local fixes for spelling,
punctuation, grammar and clarity, keeping the writer's meaning, voice and language.`;

const FIX_FORMAT = `Answer with JSON only, nothing else:
{"fixes": [{"find": "exact text from the note", "replace": "the same text, fixed", "kind": "spelling|punctuation|grammar|clarity", "why": "short reason"}]}`;

/** The fixes in a model's answer that really occur in the note; `only` gives them all one kind. */
export function parseFixes(text: string, note: string, only?: Kind): Fix[] {
  const list = jsonIn(text)?.fixes;
  if (!Array.isArray(list)) return [];
  const out: Fix[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const { find, replace, kind, why } = f as Record<string, unknown>;
    if (typeof find !== 'string' || typeof replace !== 'string' || !find.trim() || find === replace) continue;
    if (only === 'cut' && replace.length >= find.length) continue;
    if (find.includes('\n') || replace.includes('\n') || !note.includes(find)) continue;
    out.push({ find, replace, kind: only ?? (KINDS.includes(kind as Kind) ? (kind as Kind) : 'clarity'), why: typeof why === 'string' ? why.slice(0, 120) : '' });
  }
  return out;
}

const textOf = (text: unknown): string => {
  if (typeof text !== 'string' || !text.trim()) throw new AiRequestError('text is required');
  if (text.length > 60_000) throw new AiRequestError('too long to read at once');
  return text;
};

const LANG = `Write each "why" in the language the note is written in (an English note gets English reasons).`;

export async function check(complete: Complete, textIn: unknown, ins: Instructions = {}): Promise<{ fixes: Fix[] }> {
  const text = textOf(textIn);
  const reply = await complete(`${ins.proofread ?? PROOFREAD}\n\n${FIX_FORMAT}`, `${LANG}\n\nThe note:\n\n${text}`);
  return { fixes: parseFixes(reply, text) };
}

const SHRINK = `You are an editor who makes a writer's own note shorter without losing anything that matters.
Propose cuts: words, phrases or sentences to drop, or wordy phrases to say in fewer words, keeping
the writer's meaning, voice and language.`;

const CUT_FORMAT = `Answer with JSON only, nothing else:
{"fixes": [{"find": "exact text from the note", "replace": "the shorter text, or empty to drop it", "why": "short reason"}]}`;

const wordsIn = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Cuts, least needed first, adding up to about half the note's words. */
export async function shrink(complete: Complete, textIn: unknown, ins: Instructions = {}): Promise<{ fixes: Fix[] }> {
  const text = textOf(textIn);
  const total = wordsIn(text);
  const prompt = `The note has ${total} words. List cuts in order, least needed first, adding up to about half of them (${Math.round(total / 2)} words): the writer takes them in that order to cut 10, 20, 30 or 50%. ${LANG}\n\nThe note:\n\n${text}`;
  return { fixes: parseFixes(await complete(`${ins.shrink ?? SHRINK}\n\n${CUT_FORMAT}`, prompt), text, 'cut') };
}

const MARK = `You are an editor reading a writer's own note to make them a better writer. You change nothing:
you point at weak sentences (vague, flat, passive, saying little), long sentences (hard to follow
in one breath) and filler (words that add nothing), each with a short reason.`;

const MARK_FORMAT = `Answer with JSON only, nothing else:
{"marks": [{"find": "exact text from the note", "kind": "weak|long|filler", "why": "short reason"}]}`;

/** The marks in a model's answer that really occur in the note. */
export function parseMarks(text: string, note: string): Fix[] {
  const list = jsonIn(text)?.marks;
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    const { find, kind, why } = (m ?? {}) as Record<string, unknown>;
    if (typeof find !== 'string' || !find.trim() || find.includes('\n') || !note.includes(find) || !MARKS.includes(kind as Mark)) return [];
    return [{ find, replace: find, kind: kind as Mark, why: typeof why === 'string' ? why.slice(0, 120) : '' }];
  });
}

export async function marks(complete: Complete, textIn: unknown, ins: Instructions = {}): Promise<{ fixes: Fix[] }> {
  const text = textOf(textIn);
  const reply = await complete(`${ins.marks ?? MARK}\n\n${MARK_FORMAT}`, `${LANG}\n\nThe note:\n\n${text}`);
  return { fixes: parseMarks(reply, text) };
}

// --- find notes ------------------------------------------------------------------------------

export interface Proposal {
  /** One or two sentences: how the note helps this piece. */
  text: string;
  /** The other note it links, by its name (what `[[…]]` says). */
  page: string;
  quote?: string;
}

const FIND = `You help a writer by finding what in their other notes bears on the piece they are writing,
and proposing a few short notes that each link one note and say how it helps. Never change their text.`;

const SEARCH = `First answer with the searches to run, JSON only: {"search": ["query", ...]} (3 to 6 queries).`;
const AFTER = `Answer with JSON only. Either search once more, narrower (at most 3 queries):
{"search": ["query", ...]}
or propose the notes (at most 6; an empty list is fine):
{"notes": [{"text": "how it helps this piece, in the piece's language", "page": "the result's note, exactly", "quote": "optional short quote from the result"}]}`;
const LAST = `Now propose the notes, JSON only:
{"notes": [{"text": "how it helps this piece, in the piece's language", "page": "the result's note, exactly", "quote": "optional short quote from the result"}]}`;

export const queriesIn = (v: Record<string, unknown> | null, max: number): string[] =>
  Array.isArray(v?.search) ? [...new Set((v.search as unknown[]).filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim().slice(0, 300)))].slice(0, max) : [];

/** The results so far, as the AI reads them: one block per note, its best snippet. */
function render(hits: Map<string, Hit>): string {
  if (!hits.size) return '(nothing found)';
  return [...hits.values()].map((h) => `[[${h.ref}]]${h.title !== h.ref ? ` (${h.title})` : ''}\n${h.snippet.slice(0, 700)}`).join('\n\n');
}

export function proposals(v: Record<string, unknown> | null, hits: Map<string, Hit>): Proposal[] {
  if (!Array.isArray(v?.notes)) return [];
  const byTitle = new Map([...hits.values()].map((h) => [h.title, h]));
  const out: Proposal[] = [];
  for (const n of v.notes as unknown[]) {
    if (!n || typeof n !== 'object') continue;
    const { text, page, quote } = n as Record<string, unknown>;
    const ref = typeof page === 'string' ? page.replace(/^\[\[|\]\]$/g, '').trim() : '';
    const hit = hits.get(ref) ?? byTitle.get(ref);
    if (typeof text !== 'string' || !text.trim() || !hit) continue; // only notes the search found
    out.push({ text: text.trim().replace(/\s+/g, ' ').slice(0, 400), page: hit.title, ...(typeof quote === 'string' && quote.trim() ? { quote: quote.trim().slice(0, 240) } : {}) });
    if (out.length === 6) break;
  }
  return out;
}

/** The search the AI uses: words in, the best matching notes out (the server's files). */
export type Search = (query: string, limit: number) => Hit[] | Promise<Hit[]>;

export async function findNotes(complete: Complete, search: Search, r: { path?: unknown; text?: unknown }, ins: Instructions = {}): Promise<{ notes: Proposal[]; searched: string[] }> {
  const text = textOf(r?.text);
  const self = typeof r.path === 'string' ? r.path.replace(/\.md$/i, '') : '';
  const system = ins.findNotes ?? FIND;
  // Results may be in another language than the piece; the notes follow the piece.
  const piece = `Write every note in the language the piece is written in (an English piece gets English notes, whatever the language of the results).\n\nThe piece:\n\n${text}`;
  const hits = new Map<string, Hit>();
  const searched: string[] = [];
  const run = async (queries: string[]) => {
    for (const list of await Promise.all(queries.map((q) => Promise.resolve(search(q, 8)).catch(() => [] as Hit[])))) {
      for (const h of list) if (h.ref !== self && !hits.has(h.ref)) hits.set(h.ref, h);
    }
    searched.push(...queries);
  };

  let queries = queriesIn(jsonIn(await complete(system, `${piece}\n\n${SEARCH}`)), 6);
  if (!queries.length) return { notes: [], searched };
  await run(queries);
  const found = () => `Searches so far: ${searched.map((q) => `"${q}"`).join(', ')}\n\nWhat they found:\n\n${render(hits)}`;
  let v = jsonIn(await complete(system, `${piece}\n\n${found()}\n\n${AFTER}`));
  queries = queriesIn(v, 3);
  if (queries.length && !Array.isArray(v?.notes)) {
    await run(queries);
    v = jsonIn(await complete(system, `${piece}\n\n${found()}\n\n${LAST}`));
  }
  return { notes: proposals(v, hits), searched };
}

// --- changelog line --------------------------------------------------------------------------

const CHANGELOG = `You write one changelog line for a new version of a writer's note: what changed since the last
version, in a few plain words.`;

/** The note as it reads: ghosts and unkept suggestions are not part of it. */
const piece = (text: string) => {
  const n = parseNote(text);
  return [n.frontmatter, withoutGhosts(n.body, n.ghosts ?? []), n.notes].filter(Boolean).join('\n').slice(0, 40_000);
};

/** What changed since the last closed version, as a changelog line (empty when nothing is open). */
export async function suggestLog(
  complete: Complete,
  text: string,
  s: VersionState,
  before: string | null,
  ins: Instructions = {},
): Promise<{ log: string }> {
  if (!s.open) return { log: '' };
  const earlier = changelogEntries(parseNote(text).changelog ?? '').slice(-5);
  const prompt = [
    earlier.length ? `Earlier changelog lines, for their style:\n${earlier.map((l) => `- ${l}`).join('\n')}` : '',
    before === null ? 'There is no earlier version: this is the first.' : `The last version (v${s.current}):\n\n${piece(before)}`,
    `The new version (v${s.current + 1}):\n\n${piece(text)}`,
    `Answer with the changelog line only: no date, no version number, no quotes, in the note's language.`,
  ].filter(Boolean).join('\n\n---\n\n');
  const reply = await complete(ins.changelog ?? CHANGELOG, prompt);
  const log = reply.trim().split('\n')[0].replace(/^[-*•]\s*/, '').replace(/^v\d+:\s*/i, '').replace(/^["“']|["”']$/g, '').trim().slice(0, 200);
  return { log };
}
