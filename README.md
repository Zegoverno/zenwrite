# zenwrite

A calm place to write Markdown. Your notes stay plain files in a folder you choose, so Obsidian,
Git and every other tool see normal notes.

It is one app that runs three ways:

- **Standalone web app (PWA)**: open a folder, write. Installable, works offline, nothing is
  uploaded.
- **A zen plugin**: zenbot shows it as the opener for `*.md` files, and runs its tools.
- **An MCP App**: Claude, ChatGPT and any host that supports
  [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) show it inline or
  full screen, on a notes folder the server is given.

## What it does

- **Live preview.** Markdown shows as it reads: marks (`#`, `**`, links, math) are hidden except on
  the line or piece the caret touches. `$…$` and `$$…$$` math is drawn by KaTeX, loaded only for
  notes that have math. A click opens a link (`[[wiki links]]` and `.md` links open as notes).
- **Alternatives.** Select a word, sentence or paragraph and keep several ways to say it; flip
  between them in place. AI can offer more.
- **Ghosts.** Fade text out without losing it; bring it back any time.
- **Check.** AI proofreading fixes, and marks that only *point* at weak, long and filler text.
  **Shrink**: cuts, least needed first, taken for 10, 20, 30 or 50%, ghosted so nothing is lost.
- **Notes.** A `## Notes` section edited in the side panel; *Find in notes* proposes short notes
  linking other notes in the folder that help the piece.
- **Versions.** One open version at a time (the file). Closing it takes a changelog line and
  freezes a copy in `.versions/<note>/vN.md`. Old versions open read-only and can be branched from.
- **Safe saves.** A save names the hash it was based on and is refused if the file changed since:
  a note changed elsewhere is never overwritten. A new note is written only once it has something
  past its title.

### The note format

Plain Markdown. Alternatives and ghosts live in one comment at the end of the file, anchored to the
text they cover; `## Notes` and `## Changelog` are ordinary sections. Nothing else is added.

```
# Title

Body, as it reads.

<!-- zen:alternatives
{"version":1,"groups":[…]}
-->
```

`zen:alternatives` is the marker's name in the file format. Authors in it are `me`, `ai` and
`agent` (older files say `ze` and `zenbot`; they are read as `me` and `agent`).

### Keys

`Alt+L` left panel (alternatives, check, ghosts), then its next tab, then closed · `Alt+R` the same
for the right panel (notes, versions, properties) · `Alt+O` open a note · `Ctrl+S` save (it also
saves as you type, except in zenbot's Files; in a single-file browser it downloads).

The same four keys act on the tab of the panel opened last:

| Tab | `Alt+↑↓` | `Alt+Enter` | `Alt+Del` | `Alt+G` |
|---|---|---|---|---|
| alternatives | flip in place | versions of the selection (↑↓, Enter default, type + Enter adds, Esc) | remove the one showing | 🤖 versions |
| check | previous / next fix or mark | accept (a mark: done) | reject | check the piece (`Alt+P`: fixes or marks) |
| ghosts | previous / next cut, else ghost | cut it (ghosted) · bring back | keep the words · delete | ghost the selection (`Alt+K`: keep it, ghost the rest; `Alt+P`: 🤖 Shrink, then 10, 20, 30, 50%, off) |
| notes | proposed notes | keep | dismiss | find in notes (`Alt+S`: send the selection here) |
| versions | choose | open, read-only | | close this version |

## Run it standalone

```bash
npm ci
npm run build          # the PWA is in shells/web/dist: any static server will do
npm run dev            # or serve it with hot reload
```

Open a folder with **Open a folder** (Chrome, Edge and other browsers with the File System Access
API); versions are kept in that folder. Elsewhere you open one file and save by download, without
versions. AI is off in the standalone app for now: the desktop version will connect to the agent
you choose (zenbot, Claude Code or Codex).

## Install it in zenbot

```bash
npm run pack
zen plugins add ./dist/zenwrite-0.4.0.tgz
```

It asks for `files:read` and `files:write` on the notes folder, and `ai` to ask the host's model
through MCP sampling. No network permission or telemetry: file contents reach the host's model
only when you request AI help. Installing makes *Write* the opener for `*.md` in edit mode;
change it in Settings → Plugins. `/write <path>` opens a note. The host must support sampling for
AI help (see below).

### The Edit of a note in zenbot's Files

zenbot's Files reads a note with the reader plugin and edits it with zenwrite. Inside zenbot (the
host context carries `zen`) the page behaves as the Edit:

- **Looks like its host.** The theme (`light` or `dark`, the app's own choice) and the host's
  style variables (paper, soft, border, text, accent, danger/success/warning, fonts, radii, shadow)
  become the page's colours, live as the host resends them; `containerDimensions` and `zen.phone`
  shape the layout (on a phone one panel opens at a time, with *Tools* and *Note* buttons, and no
  key hints); `zen.headingFont` styles the headings. The note itself stays in the page's serif.
- **The host's chrome, not its own.** zenbot draws the title and the close ×, so the page's header
  is gone. A quiet bar shows the word count, and *Unsaved changes · ⌘S saves* while there are
  changes (*Ctrl+S* off a Mac), *Saved* after a save, and a **Done** button.
- **Saving is yours.** There is no autosave there. `Ctrl/Cmd+S` saves (the same safe save as
  everywhere: refused if the file changed since). **Done** saves and goes back to reading
  (`zen://open?path=…&mode=read`).
- **Esc** goes back to reading; with unsaved changes it asks first: *Keep editing*, *Save and
  leave* or *Discard*. Opening another note from the page asks the same.
- **Drafts.** What you type and have not saved is kept as a draft per note and comes back, with a
  *Draft restored* notice, when the note is opened again (switching tabs closes the frame). The
  app runs in a sandboxed frame without storage, so the server keeps them in the plugin's data
  folder (`drafts/`, named by a hash of the path; never in your notes folder). A draft remembers
  the note's hash: if the note changed since, saving it is refused with the *Reload / Keep mine*
  choice, never an overwrite. Saving, Done, and Discard remove the draft.

- **Keyboard, through zenbot.** The page takes part in zenbot's keyboard model (PLUGINS.md, *Keys and
  commands*), so the ring and the command list (Ctrl/Cmd+K) work from the editor. It declares:
  **Save** (`Mod+S`), **Proofread** (`Mod+Shift+F`), **Shrink** (`Mod+Shift+U`), the first three in the
  ring; **Marks** (`Mod+Shift+E`), **Find notes** (`Mod+Shift+Y`); **Alternatives for the selection**,
  **Next tools tab**, **Next note tab**, **Open a note**, **Save and go back to reading** and **Back to
  reading** (no key). Zenbot owns those shortcuts (the page does not handle them itself, and the owner can
  rebind them); the other keys keep working as above. Ctrl/Meta chords the editor does not use (Ctrl+K,
  Ctrl+., …) are handed to zenbot, and zenbot's *focus* puts the cursor in the editor. In a closed version
  only the two leaving commands remain; reading offers none.

Outside zenbot (the standalone app, Claude, ChatGPT) the page keeps its header and saves as you
type.

## Use it in Claude or ChatGPT

Build it, then add the server to the client's MCP configuration, naming the notes folder:

```json
{ "mcpServers": { "zenwrite": {
  "command": "node", "args": ["/path/to/zenwrite/mcp/dist/server.js"],
  "env": { "ZEN_PLUGIN_FILES": "/path/to/your/notes" }
} } }
```

Ask for `zenwrite_open` on a note and the app appears. Without `ZEN_PLUGIN_FILES` the file tools say
so and refuse. Clients without sampling get "AI isn't available here" from the AI tools
(`zenwrite_find_notes` still searches when given `queries`).

### Tools

All paths are relative to the notes folder: Markdown only, no `..`, no absolute paths, no dot
folders (only the plugin's own `.versions`), no symlinks out.

| Tool | |
|---|---|
| `zenwrite_open` `{path}` | shows the app; returns `{path, text, hash}` (`text` null for a new note) |
| `zenwrite_read` `{path}` | `{path, text, hash}` |
| `zenwrite_list` | `{files}` |
| `zenwrite_save` `{path, text, base_hash?}` | atomic; refused (error with `conflict: true` and the current text and hash) if the file changed since `base_hash`; omit it to create |
| `zenwrite_draft_get` `{path}` | the app's unsaved draft of a note: `{draft: {text, base, at}}` or `{draft: null}` (needs `ZEN_PLUGIN_DATA`) |
| `zenwrite_draft_put` `{path, text, base_hash?}` | keeps a draft in the data folder; not a save |
| `zenwrite_draft_drop` `{path}` | forgets it |
| `zenwrite_versions` `{path}` | `{versions, current, open}` |
| `zenwrite_close_version` `{path, changelog, base_hash?, by?}` | freezes `.versions/<note>/vN.md`, adds the changelog line; returns the new text and hash |
| `zenwrite_open_version` `{path, n}` | `{text}` of a closed version |
| `zenwrite_branch_version` `{path, n, base_hash?}` | a new open version from version n (refused while one is open) |
| `zenwrite_alternatives` `{paragraph, target, scope, existing?, title?, count?}` | AI: `{alternatives}` |
| `zenwrite_check` `{text or path, mode?: "fixes" or "marks"}` | AI: `{fixes}` (each names exact words in the note) |
| `zenwrite_shrink` `{text or path}` | AI: `{fixes}` (cuts, least needed first) |
| `zenwrite_find_notes` `{text or path, queries?}` | AI: `{notes, searched}`; with `queries`, no AI: `{hits}` |
| `zenwrite_changelog_suggest` `{path}` | AI: `{log}` |

AI tools return `{available: false, message}` when the client has no sampling. Their instructions
are the skills in `skills/writing/` (`proofread`, `marks`, `shrink`, `find-notes`, `changelog`),
read at every call: edit one and it applies at once. They hold no personal data; add your own
preferences to them.

## Develop

```
core/        pure TypeScript: the note format, versions, safe saves, AI prompts and parsers, search
ui/          Svelte 5 app (CodeMirror 6): the MCP App (ui/dist/app.html) and the PWA's UI
mcp/         the MCP server (mcp/dist/server.js, plain Node)
shells/web/  the PWA: manifest, service worker, icons
skills/      the AI's instructions
```

```bash
npm ci && npm run build && npm run check     # types + unit tests + the MCP smoke test
npm run e2e                                   # Playwright: the PWA, and the app in a stand-in host
```

`npm run e2e` needs Chromium (`npx playwright install chromium`).

Storage and AI sit behind two small interfaces in `ui/src/lib/ports.ts`, so desktop (Tauri) and
mobile (Capacitor) shells can be added without touching the editor.

## Licence

MIT.
