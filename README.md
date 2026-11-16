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
saves as you type; in a single-file browser it downloads).

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
zen plugins add ./dist/zenwrite-0.1.0.tgz
```

It asks for `files:read` and `files:write` on the notes folder, and `ai` to ask the host's model
through MCP sampling. No network permission or telemetry: file contents reach the host's model
only when you request AI help. Choose *Write* as your Markdown opener in Settings → Plugins;
installation does not replace the default. `/write <path>` opens a note. The host must support
sampling for AI help (see below).

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
