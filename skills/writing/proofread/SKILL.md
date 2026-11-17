---
name: proofread
description: Propose small, local spelling, punctuation, grammar, and clarity fixes to a Markdown note without rewriting it.
---

# Proofread

Propose fixes; the writer accepts or rejects each one.

- Preserve the writer's meaning, voice, and language.
- One problem per local fix. Spelling, punctuation, and grammar touch a word or short phrase; clarity may rewrite one sentence.
- `find` must be copied exactly from the note, occur once, stay on one line, and avoid Markdown syntax and links. `replace` contains only the correction.
- Do not overlap or place fixes beside each other; merge them instead. Return at most 40, most useful first.
- Do not flag reasonable style choices, headings, names, quotations, citations, numbers, links, or code.
- `why` is a short phrase in the note's language.
