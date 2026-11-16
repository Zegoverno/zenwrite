<script lang="ts">
  // The standalone app's first screen: pick a folder of notes (File System Access API) or, where
  // the browser has none, open one file or start one (saving is a download). Then the app proper.
  import { onMount } from 'svelte';
  import App from './App.svelte';
  import { noAi, type Host, type Store } from './lib/ports.ts';
  import { allowed, fileStore, folderStore, hasFolderAccess, pickFolder, rememberedFolder, rememberFolder } from './stores/browser.ts';
  import { memoryStore } from './stores/io.ts';

  const AI_OFF = 'AI is off in this app for now: the desktop version will connect to the agent you choose (Claude Code, Codex or zenbot). Everything else works.';
  const ai = noAi(AI_OFF);
  const host: Host = {
    openUrl: (url) => void window.open(url, '_blank', 'noopener'),
    openFile: () => {},
  };

  let store = $state<Store | null>(null);
  let start = $state<{ path: string; text?: string | null } | null>(null);
  let remembered = $state<FileSystemDirectoryHandle | null>(null);
  let error = $state('');

  onMount(async () => {
    if (hasFolderAccess()) remembered = await rememberedFolder();
    // The end-to-end tests hand the app a folder in memory; only with ?e2e in the address.
    if (new URLSearchParams(location.search).has('e2e')) {
      (window as unknown as { __zenwrite: object }).__zenwrite = {
        openMemory(files: Record<string, string>, path?: string) {
          const m = memoryStore(files, 'Test notes');
          store = m.store;
          start = path ? { path } : null;
          (window as unknown as { __zenwrite: Record<string, unknown> }).__zenwrite.read = (p: string) => m.data.get(p);
          (window as unknown as { __zenwrite: Record<string, unknown> }).__zenwrite.write = (p: string, t: string) => void m.data.set(p, t);
        },
      };
    }
  });

  async function useFolder(h: FileSystemDirectoryHandle) {
    store = folderStore(h);
    await rememberFolder(h);
  }
  async function openFolder() {
    error = '';
    try {
      await useFolder(await pickFolder());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = (e as Error).message;
    }
  }
  async function reopen() {
    error = '';
    try {
      if (remembered && (await allowed(remembered))) await useFolder(remembered);
      else error = 'Permission was not given. Pick the folder again.';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function openFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const s = fileStore(f.name.replace(/[\\/]/g, '_'), await f.text());
    store = s;
    start = { path: s.path };
  }
  function blank() {
    const s = fileStore('Untitled.md', null);
    store = s;
    start = { path: s.path };
  }
</script>

{#if store}
  <App {store} {ai} {host} {start} />
{:else}
  <main class="empty">
    <h1>zenwrite</h1>
    <p>A calm place to write Markdown. Your notes stay plain files in a folder you choose: nothing is uploaded, and it works offline.</p>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="actions">
      {#if hasFolderAccess()}
        {#if remembered}<button class="primary" onclick={reopen}>Reopen “{remembered.name}”</button>{/if}
        <button class:primary={!remembered} onclick={openFolder}>Open a folder</button>
      {/if}
      <label>Open a file<input type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onchange={openFile} /></label>
      <button onclick={blank}>New note</button>
    </div>
    {#if !hasFolderAccess()}
      <p class="note">This browser cannot keep a folder open, so you open one file and download it to save. Versions need a folder: Chrome, Edge or the desktop app give you that.</p>
    {/if}
    <p class="note">AI help is off here for now; the desktop version will connect to an agent you choose.</p>
  </main>
{/if}
