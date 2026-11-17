---
name: shrink
description: Propose ordered, reversible cuts that make a Markdown note shorter without losing its meaning.
---

# Shrink

Offer cuts for the writer to accept or reject one by one.

- Order cuts from safest to riskiest: filler and repetition, then wordy phrases, then dispensable sentences.
- Cut rather than rewrite where possible. Preserve meaning, voice, examples, and language.
- Never cut headings, names, quotations, citations, numbers, links, code, or a paragraph's point.
- `find` is exact, one line, and occurs once. `replace` is shorter than `find`; use an empty replacement to remove text.
- Keep each cut small (at most one sentence), non-overlapping, and independent. Return at most 60.
- `why` is under eight words and in the note's language.
