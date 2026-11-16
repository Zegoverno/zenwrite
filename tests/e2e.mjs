// The standalone app in headless Chromium (Playwright): the built PWA served as static files, a
// fixture folder handed in through the ?e2e test hook, typing, live preview, math, versions, the
// AI-off note and offline use. Run `npm run build` first, then `node tests/e2e.mjs`
// (Chromium: `npx playwright install chromium`).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const DIST = path.resolve(import.meta.dirname, '../shells/web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  const body = await fs.readFile(file).catch(() => null);
  if (body === null) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const FIXTURE = '# Fixture\n\nSome **bold** words and a [link](https://example.com).\n\nA formula $x^2$ here.\n';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let step = 'start';
try {
  step = 'landing';
  await page.goto(`${base}/?e2e`);
  await page.waitForSelector('text=Open a folder', { timeout: 10_000 }).catch(() => page.waitForSelector('text=Open a file'));
  assert.match(await page.textContent('main'), /AI help is off/);

  step = 'open the fixture';
  await page.waitForFunction(() => window.__zenwrite);
  await page.evaluate((text) => window.__zenwrite.openMemory({ 'Fixture.md': text, 'Other.md': '# Other\n\nA second note.\n' }, 'Fixture.md'), FIXTURE);
  await page.waitForFunction(() => window.__zw);
  const doc = () => page.evaluate(() => window.__zw.state.doc.toString());
  assert.equal(await doc(), '# Fixture\n\nSome **bold** words and a [link](https://example.com).\n\nA formula $x^2$ here.\n');

  step = 'live preview hides marks away from the caret';
  const lineText = (needle) => page.evaluate((n) => [...document.querySelectorAll('.cm-line')].map((l) => l.innerText).find((t) => t.includes(n)), needle);
  const bold = await lineText('words');
  assert.ok(bold.includes('bold') && !bold.includes('**'), `marks hidden: ${bold}`);
  const link = await lineText('link');
  assert.ok(!link.includes('](') && !link.includes('https://example.com'), `link source hidden: ${link}`);

  step = 'math loads when the note has it';
  await page.waitForSelector('.katex', { timeout: 10_000 });

  step = 'typing, and the marks of the piece the caret touches';
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nNew *italic* words');
  assert.ok((await doc()).endsWith('New *italic* words'));
  let typed = await lineText('italic words');
  assert.ok(!typed.includes('*'), `caret outside the emphasis: ${typed}`);
  await page.evaluate(() => {
    const d = window.__zw.state.doc.toString();
    window.__zw.dispatch({ selection: { anchor: d.indexOf('italic') + 2 } });
  });
  typed = await lineText('italic');
  assert.ok(typed.includes('*italic*'), `caret inside shows the marks: ${typed}`);
  await page.evaluate(() => window.__zw.dispatch({ selection: { anchor: 3 } }));
  typed = await lineText('italic words');
  assert.ok(!typed.includes('*'), `marks hide again: ${typed}`);
  await page.screenshot({ path: path.resolve(import.meta.dirname, 'shots/editor.png') }).catch(() => {});

  step = 'saves by itself, against the hash';
  await page.waitForSelector('.status-saved', { timeout: 10_000 });
  const saved = await page.evaluate(() => window.__zenwrite.read('Fixture.md'));
  assert.ok(saved.includes('New *italic* words'));

  step = 'a note changed elsewhere is not overwritten';
  await page.evaluate(() => window.__zenwrite.write('Fixture.md', '# Fixture\n\nElsewhere.\n'));
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' mine');
  await page.waitForSelector('.banner[role=alert]', { timeout: 10_000 });
  assert.match(await page.textContent('.banner'), /changed on disk/);
  assert.equal(await page.evaluate(() => window.__zenwrite.read('Fixture.md')), '# Fixture\n\nElsewhere.\n');
  await page.click('.banner button:has-text("Reload")');
  await page.waitForSelector('.status-saved');
  assert.equal(await doc(), '# Fixture\n\nElsewhere.\n');

  step = 'versions: close one with a changelog line';
  await page.keyboard.press('Alt+r'); // notes
  await page.keyboard.press('Alt+r'); // versions
  await page.waitForSelector('.side');
  await page.keyboard.press('Alt+g'); // close this version
  await page.waitForSelector('.side input, .side textarea');
  await page.keyboard.type('first words');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.side')?.textContent.includes('first words'));
  assert.match(await page.evaluate(() => window.__zenwrite.read('Fixture.md')), /## Changelog[\s\S]*v2: first words/);
  assert.ok(await page.evaluate(() => window.__zenwrite.read('.versions/Fixture.md/v1.md')));

  step = 'AI is off with a clear note';
  await page.keyboard.press('Alt+l'); // alternatives tab
  await page.keyboard.press('Alt+l'); // check tab
  await page.keyboard.press('Alt+g'); // check the piece
  await page.waitForSelector('.panel .err', { timeout: 10_000 });
  assert.match(await page.textContent('.panel .err'), /AI is off in this app/);

  step = 'the note finder opens another note';
  await page.keyboard.press('Alt+o');
  await page.waitForSelector('.opener');
  await page.keyboard.type('other');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__zw.state.doc.toString().includes('A second note'));

  step = 'offline: the service worker serves the app';
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto(`${base}/`);
  await page.waitForSelector('text=zenwrite');
  await context.setOffline(false);

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log('e2e ok');
} catch (e) {
  await page.screenshot({ path: path.resolve(import.meta.dirname, 'shots/failure.png') }).catch(() => {});
  console.error(`e2e failed at "${step}":`, e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
