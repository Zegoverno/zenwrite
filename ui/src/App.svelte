<script lang="ts">
  // The app around the editor: which note is open, the note finder, and starting a new note. It
  // knows nothing of where notes live: `store`, `ai` and `host` are given (see lib/ports.ts).
  import { onMount, untrack } from 'svelte';
  import Editor from './editor/Editor.svelte';
  import Opener from './editor/Opener.svelte';
  import { cleanFileName } from '../../core/note.ts';
  import { nav } from './lib/nav.svelte.ts';
  import type { Ai, Host, Store } from './lib/ports.ts';

  let { store, ai, host, start = null }: {
    store: Store; ai: Ai; host: Host;
    /** A note to open first. */
    start?: { path: string; text?: string | null; hash?: string | null } | null;
  } = $props();

  let current = $state<{ key: number; path: string; text: string; hash: string | null } | null>(null);
  let finding = $state(false);
  let naming = $state<{ dir: string; name: string } | null>(null);
  let error = $state('');
  let field = $state<HTMLInputElement>();
  let key = 0;

  const titleOfFile = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '');

  /** Opens a note; one that does not exist yet starts as its title, written once it has more. */
  async function openNote(path: string, given?: { text?: string | null; hash?: string | null }) {
    error = '';
    try {
      const n = given && given.text != null ? { text: given.text, hash: given.hash ?? null } : await store.read(path);
      current = { key: ++key, path, text: n?.text ?? `# ${titleOfFile(path)}\n\n`, hash: n?.hash ?? null };
      host.noteOpened?.(path, 0);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      current = null;
    }
  }

  /** A note the writer asked for: the host's to open when it takes notes (zenbot), else here. */
  async function goTo(path: string) {
    if (host.openNote && (await host.openNote(path).catch(() => false))) return;
    await openNote(path);
  }

  async function named() {
    const file = cleanFileName(naming?.name ?? '');
    if (!file || !naming) return;
    const path = naming.dir ? `${naming.dir}/${file}` : file;
    naming = null;
    await openNote(path); // an existing note opens; nothing is ever overwritten
  }

  $effect(() => {
    const r = nav.request;
    if (r) untrack(() => void openNote(r.path, r));
  });
  $effect(() => {
    if (naming) field?.focus();
  });

  onMount(() => {
    if (start) void openNote(start.path, start);
    else if (!nav.request) finding = true;
  });
</script>

<div class="app">
  {#if naming}
    <form class="ask" onsubmit={(e) => { e.preventDefault(); void named(); }}>
      <label for="f">Note name <span class="dim">in {naming.dir || store.label}/</span></label>
      <input id="f" bind:this={field} bind:value={naming.name} autocomplete="off" placeholder="My idea" />
      <p class="dim">Enter to start · Esc to cancel</p>
    </form>
  {:else if current}
    {#key current.key}
      <Editor
        path={current.path} text={current.text} hash={current.hash} {store} {ai} {host}
        reading={nav.zen?.mode === 'read'}
        open={(p) => void goTo(p)} create={(dir) => (naming = { dir, name: '' })} />
    {/key}
  {:else}
    <div class="app-bar"><button onclick={() => (finding = true)}>Notes</button><span>{store.label}</span></div>
    <div class="empty">
      <h1>{store.label}</h1>
      {#if error || nav.error}<p class="err">{error || nav.error}</p>{/if}
      <p>Open a note with <kbd>Alt</kbd>+<kbd>O</kbd>, or start one.</p>
      <div class="actions"><button class="primary" onclick={() => (finding = true)}>Open a note</button></div>
    </div>
  {/if}
  {#if finding && !current && !naming}
    <Opener files={() => store.files()} open={(p) => ((finding = false), void goTo(p))} create={(d) => ((finding = false), (naming = { dir: d, name: '' }))} close={() => (finding = false)} />
  {/if}
</div>

<svelte:window onkeydown={(e) => {
  if (naming && e.key === 'Escape') { naming = null; e.preventDefault(); }
  else if (!current && !naming && e.altKey && e.code === 'KeyO') { finding = !finding; e.preventDefault(); }
}} />
