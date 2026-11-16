// Finding notes for a piece: a plain text search over a folder's Markdown, scored by how many of
// the query's words a note holds (its title counts most). No index and no model: enough for a
// folder of notes, and honest about it. The server reads the files; this scores them.

export interface Doc {
  /** Path relative to the files folder, e.g. `ideas/Angels.md`. */
  path: string;
  text: string;
}

export interface Hit {
  /** The path without `.md`: unique, what the AI quotes back. */
  ref: string;
  /** The note's name (last segment without `.md`): what a `[[link]]` says. */
  title: string;
  path: string;
  snippet: string;
  score: number;
}

const words = (q: string) => [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'not', 'but', 'you', 'all', 'can', 'her', 'his', 'from', 'have', 'one', 'our', 'out', 'what', 'when']);

export function searchDocs(docs: Doc[], query: string, limit = 8, skip?: string): Hit[] {
  const ws = words(query).filter((w) => !STOP.has(w));
  if (!ws.length) return [];
  const hits: Hit[] = [];
  for (const d of docs) {
    if (d.path === skip) continue;
    const title = d.path.replace(/^.*\//, '').replace(/\.md$/i, '');
    const lowTitle = title.toLowerCase();
    const body = d.text.toLowerCase();
    let score = 0;
    let first = -1;
    let matched = 0;
    for (const w of ws) {
      let n = 0;
      for (let i = body.indexOf(w); i >= 0 && n < 5; i = body.indexOf(w, i + w.length)) {
        n++;
        if (first < 0 || i < first) first = i;
      }
      const inTitle = lowTitle.includes(w);
      if (n || inTitle) matched++;
      score += n + (inTitle ? 5 : 0);
    }
    if (!score) continue;
    // Notes that hold more of the query's different words come first.
    score = score * matched;
    const start = Math.max(0, first - 80);
    const snippet = d.text.slice(start, start + 360).replace(/\s+/g, ' ').trim();
    hits.push({ ref: d.path.replace(/\.md$/i, ''), title, path: d.path, snippet, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
