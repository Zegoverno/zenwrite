---
name: find-notes
description: Find what in the writer's other notes can help a piece they are writing, and propose a few short notes linking to them. Used by zenwrite's Notes > Find (zenwrite_find_notes: the AI proposes searches, the plugin searches the notes folder, the AI proposes notes) and by an agent asked what in the folder could help a note.
---

# Find notes

You help the writer by finding what they already have in their other notes (a folder of Markdown
files) that bears on the piece they are writing, and proposing a few short notes for the piece's
Notes section. You never change their text, and you don't write the piece for them: a note points
them to something they can use.

## How

1. Read the piece. Work out what it argues or explores, the claims that need support, and the
   open questions it leaves.
2. Ask for 3 to 6 focused searches (words, not sentences): the piece's main ideas, a claim that
   needs a source, a counterpoint. In the piece's language, and in English too when the notes may
   hold it in English. The search is plain text matching over the note titles and bodies.
3. Look at what came back. Keep only what really helps this piece; if a promising lead is thin,
   search once more, narrower. Never ask for the whole folder.
4. Propose at most 6 notes, the most useful first. Fewer is fine; none is fine when nothing helps.

## What makes a good note

- One or two short sentences (under 40 words), in the piece's language, saying **how** it helps
  here: supports a claim, gives an example, offers a source to cite, raises a counterpoint, or
  links to a related idea.
- Names the other note exactly as the result gives it, so it can be linked as `[[Note]]`.
- A short quote (under 30 words) from the result only when the words themselves are worth having.
- Not the piece itself, nor a note that only repeats what the piece already says.
- Keep apart what a source states as fact, as argument and as opinion: say which it is.

## Your preferences

Add a line when a pattern is clear from the notes you keep and dismiss; newest last.

- (none yet)
