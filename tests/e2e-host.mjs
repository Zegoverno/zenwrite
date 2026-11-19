// The MCP App in a stand-in host: the built ui/dist/app.html in an iframe, a minimal MCP Apps host
// page speaking the protocol over postMessage (test code only), its tool calls forwarded to the
// real mcp/dist/server.js over stdio, files on a real temp folder. No AI: the client has no sampling.
// Two hosts: a generic one (Claude-like: the note comes as a tool result) and zenbot (the note, the
// pane and the mode come in the host context under `zen`; other notes go back through ui/open-link).
// Run `npm run build` first, then `node tests/e2e-host.mjs`.
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-host-'));
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'zenwrite-host-data-'));
await fs.writeFile(path.join(dir, 'Fixture.md'), '# Fixture\n\nSome **bold** words.\n');
await fs.writeFile(path.join(dir, 'Other.md'), '# Other\n\nA second note.\n');

const client = new Client({ name: 'host', version: '0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: 'node', args: [path.join(root, 'mcp/dist/server.js')], env: { PATH: process.env.PATH, ZEN_PLUGIN_FILES: dir, ZEN_PLUGIN_DATA: data }, cwd: path.join(root, 'mcp'),
}));
const html = (await client.readResource({ uri: 'ui://zenwrite/app' })).contents[0].text;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await context.exposeFunction('callTool', async (name, args) => JSON.parse(JSON.stringify(await client.callTool({ name, arguments: args }))));
const calls = [];
await context.exposeFunction('logCall', (name) => void calls.push(name));

/** Loads the app in a stand-in host page with this host context; `open` is sent as zenwrite_open's result. */
async function host(p, hostContext, open) {
  await p.setContent('<body style="margin:0"><iframe id="app" style="width:100vw;height:100vh;border:0"></iframe></body>');
  await p.evaluate(async ({ appHtml, hostContext, open }) => {
    const frame = document.getElementById('app');
    const send = (m) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*');
    window.links = [];
    window.setContext = (ctx) => send({ method: 'ui/notifications/host-context-changed', params: ctx });
    window.addEventListener('message', async (e) => {
      if (e.source !== frame.contentWindow) return;
      const m = e.data;
      if (m.method === 'ui/initialize') {
        send({ id: m.id, result: {
          protocolVersion: m.params.protocolVersion, hostInfo: { name: 'test-host', version: '0' },
          hostCapabilities: { serverTools: {}, openLinks: {}, updateModelContext: { text: {} } },
          hostContext,
        } });
      } else if (m.method === 'ui/notifications/initialized') {
        if (open) send({ method: 'ui/notifications/tool-result', params: await window.callTool('zenwrite_open', { path: open }) });
      } else if (m.method === 'tools/call') {
        window.logCall(m.params.name);
        send({ id: m.id, result: await window.callTool(m.params.name, m.params.arguments) });
      } else if (m.method === 'ui/open-link') {
        window.links.push(m.params.url);
        send({ id: m.id, result: {} });
      } else if (m.id !== undefined && m.method) {
        send({ id: m.id, result: {} }); // ping, update-model-context, size...
      }
    });
    frame.srcdoc = appHtml;
  }, { appHtml: html, hostContext, open });
}
let step = 'start';
try {
  step = 'load the app in a host';
  await host(page, { theme: 'dark', displayMode: 'inline', platform: 'web' }, 'Fixture.md');
  const app = page.frameLocator('#app');
  await app.locator('.cm-content').waitFor({ timeout: 15_000 });
  assert.equal(await page.evaluate(() => document.getElementById('app').contentDocument.documentElement.dataset.theme), 'dark');
  assert.match(await app.locator('.file').textContent(), /Fixture\.md/);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const doc = () => frame.evaluate(() => window.__zw?.state.doc.toString());
  // the tool result carried the note; no e2e flag in the address, so the editor handle is not there: read the DOM
  const text = () => app.locator('.cm-content').innerText();
  assert.match(await text(), /Some bold words/);

  step = 'typing saves through the plugin\'s tools to the real file';
  await app.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nTyped in the app.');
  await app.locator('.status-saved').waitFor({ timeout: 10_000 });
  assert.match(await fs.readFile(path.join(dir, 'Fixture.md'), 'utf8'), /Typed in the app\./);
  assert.ok(calls.includes('zenwrite_save'));

  step = 'a note changed on disk is refused, not overwritten';
  await fs.writeFile(path.join(dir, 'Fixture.md'), '# Fixture\n\nChanged elsewhere.\n');
  await page.keyboard.type(' mine');
  await app.locator('.banner[role=alert]').waitFor({ timeout: 10_000 });
  assert.equal(await fs.readFile(path.join(dir, 'Fixture.md'), 'utf8'), '# Fixture\n\nChanged elsewhere.\n');
  await app.locator('.banner button:has-text("Reload")').click();
  await app.locator('.status-saved').waitFor();
  assert.match(await text(), /Changed elsewhere/);

  step = 'versions through the tools';
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' More.');
  await app.locator('.status-saved').waitFor({ timeout: 10_000 });
  await page.keyboard.press('Alt+r');
  await page.keyboard.press('Alt+r');
  await page.keyboard.press('Alt+g');
  await app.locator('.side input, .side textarea').first().waitFor();
  await page.keyboard.type('two edits');
  await page.keyboard.press('Enter');
  await app.locator('.side', { hasText: 'two edits' }).waitFor({ timeout: 10_000 });
  assert.match(await fs.readFile(path.join(dir, 'Fixture.md'), 'utf8'), /v2: two edits/);
  assert.ok(await fs.stat(path.join(data, 'versions/Fixture.md/v2.md')));

  step = 'AI answers that it is not available here';
  await page.keyboard.press('Alt+l');
  await page.keyboard.press('Alt+l');
  await page.keyboard.press('Alt+g');
  await app.locator('.panel .err').waitFor({ timeout: 10_000 });
  assert.match(await app.locator('.panel .err').textContent(), /AI isn't available here/);

  step = 'the note finder lists the folder through the plugin';
  await page.keyboard.press('Alt+o');
  await app.locator('.opener').waitFor();
  await page.keyboard.type('other');
  await page.keyboard.press('Enter');
  await app.locator('.cm-content', { hasText: 'A second note' }).waitFor({ timeout: 10_000 });

  step = 'zenbot: the note, pane and mode come in the host context';
  const zen = await context.newPage();
  zen.on('pageerror', (e) => errors.push(e.message));
  await host(zen, { theme: 'light', zen: { pane: 'side', path: 'Other.md', mode: 'read', slot: 'opener' } }, null);
  const zapp = zen.frameLocator('#app');
  await zapp.locator('.cm-content', { hasText: 'A second note' }).waitFor({ timeout: 15_000 });
  const rootData = () => zen.evaluate(() => ({ ...document.getElementById('app').contentDocument.documentElement.dataset }));
  assert.deepEqual(await rootData(), { theme: 'light', pane: 'side', slot: 'opener', mode: 'read' });
  assert.equal(await zapp.locator('.cm-content').getAttribute('contenteditable'), 'false', 'mode read: read-only');

  step = 'zenbot: switching to edit brings the tools back';
  await zen.evaluate(() => window.setContext({ zen: { pane: 'side', path: 'Other.md', mode: 'edit', slot: 'opener' } }));
  await zapp.locator('.cm-content[contenteditable=true]').waitFor({ timeout: 10_000 });

  step = 'zenbot: another note goes to the host as zen://open, then comes back in the context';
  await zapp.locator('.cm-content').click();
  await zen.keyboard.press('Alt+o');
  await zapp.locator('.opener').waitFor();
  await zen.keyboard.type('fixture');
  await zen.keyboard.press('Enter');
  await zen.waitForFunction(() => window.links.length > 0, null, { timeout: 10_000 });
  assert.deepEqual(await zen.evaluate(() => window.links), ['zen://open?path=Fixture.md&mode=edit'], 'edit stays edit');
  await zen.evaluate(() => window.setContext({ zen: { pane: 'side', path: 'Fixture.md', mode: 'edit', slot: 'opener' } }));
  await zapp.locator('.cm-content', { hasText: 'Changed elsewhere' }).waitFor({ timeout: 10_000 });

  // --- zenbot's Files: the editor as the Edit of a note ------------------------------------------
  const zenHost = async (note, extra = {}) => {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await host(p, {
      theme: 'light',
      styles: { variables: {
        '--color-background-primary': 'rgb(250, 249, 245)', '--color-text-primary': 'rgb(31, 29, 26)', '--color-text-info': 'rgb(74, 122, 90)',
        '--color-text-danger': 'rgb(181, 84, 60)', '--border-radius-md': '11px', '--font-sans': 'Inter, sans-serif',
      } },
      containerDimensions: { width: 900, height: 700 },
      zen: { pane: 'board', path: note, mode: 'edit', slot: 'opener', phone: false, headingFont: 'Fraunces, serif', ...extra },
    }, null);
    const a = p.frameLocator('#app');
    await a.locator('.cm-content[contenteditable=true]').waitFor({ timeout: 15_000 });
    return { p, a, links: () => p.evaluate(() => window.links) };
  };
  const onDisk = (n) => fs.readFile(path.join(dir, n), 'utf8');
  const draft = async (n) => JSON.parse((await client.callTool({ name: 'zenwrite_draft_get', arguments: { path: n } })).content[0].text).draft;
  await fs.writeFile(path.join(dir, 'Zen.md'), '# Zen\n\nCalm words.\n');

  step = 'zenbot edit: the host\'s tokens, size, phone and heading font apply, live';
  {
    const { p, a } = await zenHost('Zen.md');
    const css = (name) => p.evaluate((n) => getComputedStyle(document.getElementById('app').contentDocument.documentElement).getPropertyValue(n).trim(), name);
    assert.equal(await css('--color-background-primary'), 'rgb(250, 249, 245)');
    assert.equal(await css('--accent'), await css('--color-text-info'));
    assert.equal(await css('--radius-md'), '11px');
    assert.equal(await css('--host-width'), '900px');
    assert.equal(await css('--zw-heading-font'), 'Fraunces, serif');
    assert.equal(await a.locator('header').count(), 0, 'the host draws the title: no own header');
    assert.equal(await a.locator('.zb-tool').count(), 0, 'no phone buttons on a desktop');
    await p.evaluate(() => window.setContext({
      theme: 'dark', styles: { variables: { '--color-text-info': 'rgb(1, 2, 3)' } }, containerDimensions: { width: 400, height: 600 },
      zen: { pane: 'board', path: 'Zen.md', mode: 'edit', slot: 'opener', phone: true },
    }));
    await a.locator('.zb-tool').first().waitFor({ timeout: 5000 });
    const root = await p.evaluate(() => ({ ...document.getElementById('app').contentDocument.documentElement.dataset }));
    assert.equal(root.theme, 'dark');
    assert.equal(root.size, 'compact');
    assert.ok('phone' in root);
    assert.equal(await css('--zw-heading-font'), '');
    assert.equal(await css('--host-width'), '400px');
    assert.equal(await css('--color-text-info'), 'rgb(1, 2, 3)');
    // one panel at a time on a phone
    await a.locator('.zb-tool', { hasText: 'Tools' }).click();
    await a.locator('.panel').waitFor();
    await a.locator('.zb-tool', { hasText: 'Note' }).click();
    await a.locator('.side').waitFor();
    assert.equal(await a.locator('.panel').count(), 0);
    await p.close();
  }

  step = 'zenbot edit: no autosave; the quiet line; Ctrl+S saves';
  {
    const { p, a } = await zenHost('Zen.md');
    await a.locator('.cm-content').click();
    await p.keyboard.press('Control+End');
    await p.keyboard.type(' Typed.');
    await a.locator('.zb-status', { hasText: 'Unsaved changes · ' }).waitFor({ timeout: 5000 });
    assert.match(await a.locator('.zb-status').textContent(), /^Unsaved changes · (Ctrl\+S|⌘S) saves$/);
    await p.waitForTimeout(1600);
    assert.doesNotMatch(await onDisk('Zen.md'), /Typed\./, 'nothing is saved as you type');
    await p.keyboard.press('Control+s');
    await a.locator('.zb-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    assert.match(await onDisk('Zen.md'), /Calm words\.\n Typed\./);
    await a.locator('.zb-status', { hasText: 'Saved' }).waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
    assert.equal((await a.locator('.zb-status').textContent()).trim(), '', 'quiet when saved');
    await p.close();
  }

  step = 'zenbot edit: a draft is kept per note and comes back with a notice';
  {
    const first = await zenHost('Zen.md');
    await first.a.locator('.cm-content').click();
    await first.p.keyboard.press('Control+End');
    await first.p.keyboard.type(' Half a thought');
    await first.p.waitForFunction(() => true);
    for (let i = 0; i < 50 && !(await draft('Zen.md')); i++) await first.p.waitForTimeout(100);
    assert.match((await draft('Zen.md')).text, /Half a thought/);
    assert.doesNotMatch(await onDisk('Zen.md'), /Half a thought/);
    await first.p.close(); // the frame is gone: switching tabs tears it down
    const back = await zenHost('Zen.md');
    await back.a.locator('.zb-status', { hasText: 'Draft restored' }).waitFor({ timeout: 8000 });
    assert.match(await back.a.locator('.cm-content').innerText(), /Half a thought/);
    assert.doesNotMatch(await onDisk('Zen.md'), /Half a thought/, 'a restored draft is not a save');
    // another note has no draft
    const other = await zenHost('Other.md');
    assert.doesNotMatch(await other.a.locator('.cm-content').innerText(), /Half a thought/);
    await other.p.close();
    // Ctrl+S saves it and the draft goes
    await back.p.keyboard.press('Control+s');
    await back.a.locator('.zb-status', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
    assert.match(await onDisk('Zen.md'), /Half a thought/);
    for (let i = 0; i < 50 && (await draft('Zen.md')); i++) await back.p.waitForTimeout(100);
    assert.equal(await draft('Zen.md'), null);
    await back.p.close();
  }

  step = 'zenbot edit: Esc with nothing unsaved goes back to reading';
  {
    const { p, a, links } = await zenHost('Zen.md');
    await a.locator('.cm-content').click();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.links.length > 0, null, { timeout: 5000 });
    assert.deepEqual(await links(), ['zen://open?path=Zen.md&mode=read']);
    await p.close();
  }

  step = 'zenbot edit: Esc with unsaved changes asks: keep editing, save and leave, discard';
  {
    const { p, a, links } = await zenHost('Zen.md');
    const before = await onDisk('Zen.md');
    await a.locator('.cm-content').click();
    await p.keyboard.press('Control+End');
    await p.keyboard.type(' Maybe.');
    await p.keyboard.press('Escape');
    await a.locator('.leave[role=alertdialog]').waitFor({ timeout: 5000 });
    assert.match(await a.locator('.leave').textContent(), /You have unsaved changes/);
    assert.deepEqual(await links(), [], 'it did not leave');
    await a.locator('.leave button', { hasText: 'Keep editing' }).click();
    assert.equal(await a.locator('.leave').count(), 0);
    assert.match(await a.locator('.cm-content').innerText(), /Maybe\./);
    await p.keyboard.press('Escape');
    await a.locator('.leave').waitFor();
    await p.keyboard.press('Escape'); // a second Esc is Keep editing
    await a.locator('.leave').waitFor({ state: 'detached' });
    await p.keyboard.press('Escape');
    await a.locator('.leave button', { hasText: 'Discard' }).click();
    await p.waitForFunction(() => window.links.length > 0, null, { timeout: 5000 });
    assert.deepEqual(await links(), ['zen://open?path=Zen.md&mode=read']);
    assert.equal(await onDisk('Zen.md'), before, 'discard writes nothing');
    await p.waitForTimeout(800);
    assert.equal(await draft('Zen.md'), null, 'and keeps no draft');
    await p.close();

    const two = await zenHost('Zen.md');
    await two.a.locator('.cm-content').click();
    await two.p.keyboard.press('Control+End');
    await two.p.keyboard.type(' Kept.');
    await two.p.keyboard.press('Escape');
    await two.a.locator('.leave button', { hasText: 'Save and leave' }).click();
    await two.p.waitForFunction(() => window.links.length > 0, null, { timeout: 5000 });
    assert.deepEqual(await two.links(), ['zen://open?path=Zen.md&mode=read']);
    assert.match(await onDisk('Zen.md'), /Kept\./);
    await two.p.close();
  }

  step = 'zenbot edit: Done saves and goes back to reading';
  {
    const { p, a, links } = await zenHost('Zen.md');
    await a.locator('.cm-content').click();
    await p.keyboard.press('Control+End');
    await p.keyboard.type(' Done now.');
    await a.locator('.zb-done').click();
    await p.waitForFunction(() => window.links.length > 0, null, { timeout: 5000 });
    assert.deepEqual(await links(), ['zen://open?path=Zen.md&mode=read']);
    assert.match(await onDisk('Zen.md'), /Done now\./);
    assert.equal(await draft('Zen.md'), null);
    await p.close();
  }

  step = 'zenbot edit: a note that changed since the draft is not overwritten';
  {
    const first = await zenHost('Zen.md');
    await first.a.locator('.cm-content').click();
    await first.p.keyboard.press('Control+End');
    await first.p.keyboard.type(' Stale draft.');
    for (let i = 0; i < 50 && !(await draft('Zen.md')); i++) await first.p.waitForTimeout(100);
    await first.p.close();
    await fs.writeFile(path.join(dir, 'Zen.md'), '# Zen\n\nChanged by an agent.\n');
    const back = await zenHost('Zen.md');
    await back.a.locator('.zb-status', { hasText: 'Draft restored' }).waitFor({ timeout: 8000 });
    await back.p.keyboard.press('Control+s');
    await back.a.locator('.banner[role=alert]').waitFor({ timeout: 8000 });
    assert.equal(await onDisk('Zen.md'), '# Zen\n\nChanged by an agent.\n');
    await back.p.close();
  }

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log('host e2e ok');
} catch (e) {
  await page.screenshot({ path: path.join(root, 'tests/shots/host-failure.png') }).catch(() => {});
  for (const p of browser.contexts().flatMap((c) => c.pages())) console.error('frame text:', (await p.frames().at(-1).evaluate(() => document.body.innerText).catch((x) => String(x))).slice(0, 400));
  console.error('page errors:', errors);
  console.error(`host e2e failed at "${step}":`, e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await client.close();
}
