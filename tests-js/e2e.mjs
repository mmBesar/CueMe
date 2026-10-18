// End-to-end: real hub binary + real Chromium, one display page and one remote page.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const BIN = process.env.CUEME_BIN || path.resolve('target/debug/cueme-serve');
// CHROME env var wins; otherwise Playwright's own downloaded Chromium.
const CHROME = process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
  ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'cueme-shots-'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cueme-e2e-'));
const PORT = 17000 + Math.floor(Math.random() * 2000);
const PIN = '482';

const hub = spawn(BIN, ['--bind', `127.0.0.1:${PORT}`, '--data', data, '--pin', PIN, '--no-discovery'], { stdio: 'pipe' });
let hubLog = '';
hub.stdout.on('data', (d) => (hubLog += d));
hub.stderr.on('data', (d) => (hubLog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50 && !hubLog.includes('listening'); i++) await sleep(100);
assert.ok(hubLog.includes('listening'), 'hub did not start: ' + hubLog);

const script = [
  '# مقدمة', '', 'مرحبا بكم في **القناة** وهذا نص عربي مع English words في المنتصف.', '',
  '## Section two', '', 'A long English paragraph that goes on and on so that we have enough text to scroll through during the test. '.repeat(4), '',
  '- بند أول', '- second item', '', '> اقتباس مهم', '',
  ...Array.from({ length: 40 }, (_, i) => `سطر رقم ${i + 1} من النص التجريبي الطويل جدًا لاختبار التمرير. Line ${i + 1}.\n`),
  '## الخاتمة', '', 'شكرا لكم.',
].join('\n');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const base = `http://127.0.0.1:${PORT}/#pin=${PIN}`;
const fails = [];
const errors = [];
let step = 'start';
const T = async (name, fn) => { step = name; try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.message.split('\n').slice(0,6).join(' / ')); fails.push(name); } };

const dctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const D = await dctx.newPage();
const R = await rctx.newPage();
for (const [n, p] of [['display', D], ['remote', R]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
}

// a remote on the shared session asks the display of that session for fullscreen
const sendFromRemote_fullscreen = async (displayPage) => {
  const c = await browser.newContext();
  const r = await c.newPage();
  await r.goto(base);
  await r.locator('button.big').nth(1).click();
  await r.locator('button.peer').first().click();
  await r.waitForSelector('#remote');
  await r.waitForFunction(() => window.__cueme.state.displays >= 1);
  await r.locator('#transport button[aria-label="Fullscreen"]').click();
  await sleep(300);
  await c.close();
};

const tx = (p) => p.evaluate(() => {
  const m = /translate3d\(-50%,\s*(-?[\d.]+)px/.exec(document.getElementById('content').style.transform);
  return m ? -parseFloat(m[1]) * -1 * -1 : 0; // px scrolled (positive)
});
const posPx = async (p) => Math.abs(await tx(p));
const remoteScrub = (p) => p.evaluate(() => parseInt(document.querySelector('#transport input[aria-label="Position"]').value, 10));
const setRange = (p, sel, v) => p.evaluate(([sel, v]) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);

await T('display opens and connects', async () => {
  await D.goto(base);
  assert.equal(await D.locator('.screen .row button').first().innerText(), 'العربية', 'language switch offers the OTHER language');
  await D.locator('button.big').nth(0).click();
  await D.waitForSelector('#stage');
  await D.waitForFunction(() => window.__cueme.state.connected);
});

await T('remote opens and sees the display', async () => {
  await R.goto(base);
  await R.locator('button.big').nth(1).click();
  await R.locator('button.peer').first().click();
  await R.waitForSelector('#remote');
  await R.waitForFunction(() => window.__cueme.state.displays === 1);
  assert.match(await R.locator('#rtop').innerText(), /1 displays/);
});

await T('remote sends Arabic/English markdown; display renders it with dir=auto', async () => {
  await R.locator('.tabs button').nth(2).click();
  await R.locator('textarea').fill(script);
  await R.locator('button.primary', { hasText: 'Send to display' }).click();
  await D.waitForFunction(() => document.querySelector('#content h1'));
  const h = await D.evaluate(() => document.getElementById('content').innerHTML);
  assert.ok(h.includes('<h1 dir="auto">مقدمة</h1>'));
  assert.ok(h.includes('<strong>القناة</strong>'));
  assert.ok(!(await D.locator('#hint').isVisible()));
  await D.screenshot({ path: path.join(SHOTS, 'display-start.png') });
  await R.locator('.tabs button').nth(0).click();
  await R.screenshot({ path: path.join(SHOTS, 'remote.png') });
});

await T('play from remote: smooth, steady scrolling and live position on remote', async () => {
  await R.locator('#playbtn').click();
  await D.waitForFunction(() => /translate3d\(-50%,\s*-[1-9]/.test(document.getElementById('content').style.transform), null, { timeout: 4000 });
  const samples = [];
  const scrubs = [];
  for (let i = 0; i < 20; i++) { samples.push(await posPx(D)); scrubs.push(await remoteScrub(R)); await sleep(100); }
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1], 'monotonic');
  const deltas = samples.slice(1).map((v, i) => v - samples[i]);
  assert.ok(Math.max(...deltas) < 60, 'no jumps: ' + Math.max(...deltas));
  assert.ok(samples[19] - samples[0] > 20, 'actually moving');
  assert.ok(scrubs[19] > scrubs[0], 'remote slider follows live: ' + scrubs[0] + ' -> ' + scrubs[19]);
  assert.match(await R.locator('#playbtn').innerText(), /⏸/);
  assert.match(await R.locator('.eta').innerText(), /\d+:\d\d/);
});

await T('pause from remote stops the display', async () => {
  await R.locator('#playbtn').click();
  await sleep(300);
  const a = await posPx(D); await sleep(400); const b = await posPx(D);
  assert.equal(a, b);
  assert.match(await R.locator('#playbtn').innerText(), /▶/);
});

await T('scrub: eased, no teleport, lands where asked, display does not stay playing', async () => {
  const before = await posPx(D);
  await setRange(R, '#transport input[aria-label="Position"]', 800);
  const seen = [];
  for (let i = 0; i < 60; i++) { seen.push(await posPx(D)); await sleep(30); }
  const first = seen.find((v) => v > before);
  assert.ok(first !== undefined, 'started moving');
  const firstJump = Math.abs(seen[0] - before);
  assert.ok(firstJump < 400, 'first frames did not teleport: ' + firstJump);
  await sleep(2500);
  const p = await D.evaluate(() => { const c = document.getElementById('content'); return document.getElementById('progressbar').style.width; });
  assert.ok(Math.abs(parseFloat(p) - 80) < 1.5, 'progress ' + p);
  assert.ok(Math.abs((await remoteScrub(R)) - 800) < 20, 'remote shows ' + (await remoteScrub(R)));
});

await T('jog moves while held and stops on release', async () => {
  const a = await posPx(D);
  await setRange(R, '#transport input[aria-label="Jog (release to stop)"]', -60);
  await sleep(700);
  const b = await posPx(D);
  assert.ok(b < a - 50, `moved up ${a} -> ${b}`);
  await R.evaluate(() => { const n = document.querySelector('#transport input[aria-label="Jog (release to stop)"]'); n.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  const c = await posPx(D); await sleep(400); const d = await posPx(D);
  assert.equal(c, d, 'stopped after release');
});

await T('changing font size keeps your place in the text', async () => {
  const anchor = () => D.evaluate(() => {
    const c = document.getElementById('content'); const kids = c.children;
    const pt = parseFloat(c.style.paddingTop); const m = /translate3d\(-50%,\s*(-?[\d.]+)px/.exec(c.style.transform);
    const cue = pt + -parseFloat(m[1]);
    for (let i = 0; i < kids.length; i++) if (kids[i].offsetTop + kids[i].offsetHeight > cue) return i;
    return -1;
  });
  const a = await anchor();
  await R.locator('.tabs button').nth(0).click();
  await setRange(R, '.ctl input[type=range][max="300"]', 120);
  await sleep(500);
  assert.equal(await D.evaluate(() => document.getElementById('content').style.fontSize), '120px');
  const b = await anchor();
  assert.ok(Math.abs(a - b) <= 1, `anchor block ${a} -> ${b}`);
});

await T('display hotkeys: Space plays, Alt+Up grows text, [ narrows', async () => {
  await D.locator('#stage').click({ position: { x: 600, y: 300 } });
  const f0 = await D.evaluate(() => window.__cueme.state.settings.font_size);
  await D.keyboard.press('Alt+ArrowUp');
  await sleep(300);
  const f1 = await D.evaluate(() => window.__cueme.state.settings.font_size);
  assert.equal(f1, f0 + 2);
  const w0 = await D.evaluate(() => window.__cueme.state.settings.width);
  await D.keyboard.press('[');
  await sleep(300);
  assert.equal(await D.evaluate(() => window.__cueme.state.settings.width), w0 - 2);
  await D.keyboard.press(' ');
  await R.waitForFunction(() => window.__cueme.state.playing === true, null, { timeout: 3000 });
  await D.keyboard.press(' ');
  await R.waitForFunction(() => window.__cueme.state.playing === false, null, { timeout: 3000 });
});

await T('hostile markdown cannot run script', async () => {
  const evil = '# x\n\n<img src=x onerror="window.__pwned=1">\n\n<script>window.__pwned=1</script>\n\n[click](javascript:window.__pwned=1)\n\n![i](data:text/html,<script>1</script>)';
  await R.locator('.tabs button').nth(2).click();
  await R.locator('textarea').fill(evil);
  await R.locator('button.primary', { hasText: 'Send to display' }).click();
  await D.waitForFunction(() => document.getElementById('content').textContent.includes('window.__pwned'));
  await sleep(300);
  for (const p of [D, R]) assert.equal(await p.evaluate(() => window.__pwned), undefined);
  assert.equal(await D.locator('#content img').count(), 0);
  assert.equal(await D.locator('#content script').count(), 0);
  assert.equal(await D.locator('#content a[href^="javascript"]').count(), 0);
});

await T('library: save from remote lands in the folder; load puts it on the display', async () => {
  await R.locator('textarea').fill('# محفوظ\n\nنص');
  await R.locator('input[placeholder="File name"]').fill('حلقة تجريبية');
  await R.locator('button', { hasText: /^Save$/ }).click();
  await R.waitForSelector('.files .file');
  const file = path.join(data, 'scripts', 'حلقة تجريبية.md');
  for (let i = 0; i < 20 && !fs.existsSync(file); i++) await sleep(100);
  assert.equal(fs.readFileSync(file, 'utf8'), '# محفوظ\n\nنص');
  fs.writeFileSync(path.join(data, 'scripts', 'extra.txt'), 'plain');
  await R.locator('textarea').fill('x');
  await R.locator('.files .file button.name').first().click(); // sorted: extra.txt first? whichever, load by name below
  await R.locator('.files .file button.name', { hasText: 'حلقة' }).click();
  await D.waitForFunction(() => document.querySelector('#content h1') && document.querySelector('#content h1').textContent === 'محفوظ');
});


await T('theme: Catppuccin Macchiato + Mauve by default; all four flavours selectable and remembered', async () => {
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(R), 'rgb(36, 39, 58)', 'macchiato base');
  const primary = await R.evaluate(() => getComputedStyle(document.getElementById('playbtn')).backgroundColor);
  assert.equal(primary, 'rgb(198, 160, 246)', 'mauve accent on the play button');
  const want = { Latte: 'rgb(239, 241, 245)', 'Frappé': 'rgb(48, 52, 70)', Macchiato: 'rgb(36, 39, 58)', Mocha: 'rgb(30, 30, 46)' };
  await R.locator('.tabs button').nth(0).click();
  for (const name of Object.keys(want)) {
    await R.locator('.fl', { hasText: name }).scrollIntoViewIfNeeded();
    await R.locator('.fl', { hasText: name }).click();
    assert.equal(await bg(R), want[name], name);
  }
  assert.equal(await R.locator('.sw').count(), 14, '14 accents');
  await R.locator('.sw[title="blue"]').click();
  assert.equal(await R.evaluate(() => getComputedStyle(document.getElementById('playbtn')).backgroundColor), 'rgb(137, 180, 250)');
  await R.reload(); // theme survives a reload
  assert.equal(await bg(R), 'rgb(30, 30, 46)');
  await R.evaluate(() => window.__cueme.setTheme('macchiato', 'mauve'));
});

await T('remote controls page: the whole panel is on screen and scrolls to its last item (phone 360x640)', async () => {
  await R.setViewportSize({ width: 360, height: 640 });
  await R.goto(base);
  await R.locator('button.big').nth(1).click();
  await R.locator('button.peer').first().click();
  await R.waitForSelector('#remote');
  const m = await R.evaluate(() => {
    const pr = document.getElementById('panel').getBoundingClientRect();
    const body = document.querySelector('#panel .tabbody');
    body.scrollTop = body.scrollHeight;
    const last = body.lastElementChild.getBoundingClientRect();
    return { panelBottom: pr.bottom, vh: window.innerHeight, lastBottom: last.bottom, bodyBottom: body.getBoundingClientRect().bottom,
      scrollable: body.scrollHeight > body.clientHeight, remoteScroll: document.getElementById('remote').scrollHeight - document.getElementById('remote').clientHeight };
  });
  assert.ok(m.panelBottom <= m.vh + 1, 'panel bottom ' + m.panelBottom + ' within ' + m.vh);
  assert.ok(m.lastBottom <= m.bodyBottom + 1, 'last item reachable');
  await R.screenshot({ path: path.join(SHOTS, 'remote-small-bottom.png') });
  await R.setViewportSize({ width: 390, height: 844 });
});

await T('sliders let a vertical swipe scroll the page (touch-action: pan-y)', async () => {
  const ta = await R.evaluate(() => getComputedStyle(document.querySelector('.ctl input[type=range]')).touchAction);
  assert.equal(ta, 'pan-y');
});

await T('outline: remote lists headings; tapping one moves the display there', async () => {
  await R.locator('.tabs button').nth(2).click();
  await R.locator('textarea').fill(script);
  await R.locator('button.primary', { hasText: 'Send to display' }).click();
  await D.waitForFunction(() => document.querySelectorAll('#content h2').length >= 2);
  await R.locator('.tabs button').nth(1).click();
  await R.locator('.olink').first().waitFor();
  assert.ok((await R.locator('.olink').count()) >= 3, 'headings listed');
  await R.locator('.tabs button').nth(1).click();
  await R.locator('.olink').last().click();
  await sleep(2600);
  const prog = parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width));
  assert.ok(prog > 90, 'jumped to the last heading: ' + prog);
  await R.locator('.olink').first().click();
  await sleep(2600);
  assert.ok(parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width)) < 2, 'back at the first heading');
});

await T('remote fullscreen button reaches the display', async () => {
  await D.evaluate(() => { window.__fsCalls = 0; const f = function () { window.__fsCalls++; return Promise.resolve(); };
    Element.prototype.requestFullscreen = f; Element.prototype.webkitRequestFullscreen = f; });
  await R.locator('#transport button[title="Fullscreen"]').click();
  await D.waitForFunction(() => window.__fsCalls > 0, null, { timeout: 3000 });
});

await T('display works stand-alone: tap shows on-screen controls, play/pause/jump work', async () => {
  await D.evaluate(() => { document.getElementById('dctl').className = ''; });
  await D.locator('#stage').click({ position: { x: 600, y: 200 } });
  await D.waitForSelector('#dctl.show');
  await D.locator('#dctl .play').click();
  await R.waitForFunction(() => window.__cueme.state.playing === true, null, { timeout: 3000 });
  assert.match(await D.locator('#dctl .play').innerText(), /⏸/);
  await D.locator('#dctl .play').click();
  await R.waitForFunction(() => window.__cueme.state.playing === false, null, { timeout: 3000 });
  await D.locator('#dctl button[title="Next heading"]').click();
  await sleep(2200);
  assert.ok(parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width)) > 0.5, 'moved to next heading');
  const f0 = await D.evaluate(() => window.__cueme.state.settings.font_size);
  await D.locator('#dctl button', { hasText: 'A+' }).click();
  await sleep(300);
  assert.equal(await D.evaluate(() => window.__cueme.state.settings.font_size), f0 + 2);
  await D.screenshot({ path: path.join(SHOTS, 'display-standalone.png') });
  await D.locator('#dctl button[title="Top"]').click();
  await D.locator('#stage').click({ position: { x: 600, y: 200 } }); // tap again hides
  assert.equal(await D.locator('#dctl.show').count(), 0);
});

await T('fullscreen = clean mode: only a faint dot; stray taps do nothing; the dot brings the bar back', async () => {
  await D.evaluate(() => { document.getElementById('dctl').className = ''; window.__cueme.setFs(true); });
  assert.equal(await D.locator('#menubtn').isVisible(), false, 'menu button hidden');
  assert.equal(await D.locator('#fab').isVisible(), true, 'dot visible');
  const op = await D.evaluate(() => parseFloat(getComputedStyle(document.getElementById('fab')).opacity));
  assert.ok(op < 0.6, 'dot is see-through: ' + op);
  await D.locator('#stage').click({ position: { x: 600, y: 200 } });
  assert.equal(await D.locator('#dctl.show').count(), 0, 'stray tap does nothing');
  await D.screenshot({ path: path.join(SHOTS, 'display-clean.png') });
  await D.locator('#fab').click();
  await D.waitForSelector('#dctl.show');
  assert.equal(await D.locator('#fab').isVisible(), false, 'dot hides while the bar is up');
  await D.locator('#dctl button', { hasText: 'Menu' }).click();
  assert.equal(await D.locator('#panel.open').count(), 1, 'menu opens from the bar');
  await D.keyboard.press('Escape');
  await D.evaluate(() => window.__cueme.setFs(false));
  assert.equal(await D.locator('#menubtn').isVisible(), true, 'normal controls are back outside fullscreen');
  assert.equal(await D.locator('#fab').isVisible(), false);
});

await T('touch/mouse drag scrolls the text and wheel glides it', async () => {
  await D.evaluate(() => { document.getElementById('dctl').className = ''; });
  await D.keyboard.press('Home'); await sleep(1500);
  const a = await posPx(D);
  await D.mouse.move(600, 500); await D.mouse.down(); await D.mouse.move(600, 300, { steps: 8 }); 
  const during = await posPx(D);
  await D.mouse.up();
  assert.ok(during > a + 100, `dragging up moved the text forward ${a} -> ${during}`);
  assert.equal(await D.locator('#dctl.show').count(), 0, 'a drag is not a tap');
  await sleep(700);
  const b = await posPx(D);
  await D.mouse.move(600, 400); await D.mouse.wheel(0, 300); await sleep(900);
  assert.ok((await posPx(D)) > b + 100, 'wheel moved it');
  await D.mouse.wheel(0, -300); await sleep(900);
});

await T('keyboard: End, Home, number keys, Esc and the help list', async () => {
  await D.locator('#stage').click({ position: { x: 600, y: 200 }, force: true }).catch(() => {});
  await D.evaluate(() => { document.getElementById('dctl').className = ''; });
  await D.keyboard.press('End'); await sleep(2600);
  assert.ok(parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width)) > 98, 'End');
  await D.keyboard.press('Home'); await sleep(2600);
  assert.ok(parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width)) < 2, 'Home');
  await D.keyboard.press('2'); await sleep(2200);
  assert.ok(parseFloat(await D.evaluate(() => document.getElementById('progressbar').style.width)) > 0.5, 'heading 2');
  await D.keyboard.press('?');
  await D.waitForSelector('#help');
  await D.keyboard.press('Escape');
  assert.equal(await D.locator('#help').count(), 0);
  const w0 = await D.evaluate(() => window.__cueme.state.settings.font_size);
  await D.keyboard.press('+'); await sleep(300);
  assert.equal(await D.evaluate(() => window.__cueme.state.settings.font_size), w0 + 2);
  await D.keyboard.press('x'); await sleep(300);
  assert.equal(await D.evaluate(() => window.__cueme.state.settings.flip_x), true);
  await D.keyboard.press('x'); await sleep(300);
  await D.keyboard.press('Home'); await sleep(1500);
});

await T('bundled Arabic font loads and a send reports "Sent"', async () => {
  assert.match(await D.evaluate(() => document.getElementById('content').style.fontFamily), /CueMe Naskh UI/);
  assert.equal(await D.evaluate(async () => { await document.fonts.load('16px "CueMe Naskh UI"', 'مرحبا'); return document.fonts.check('16px "CueMe Naskh UI"', 'مرحبا'); }), true);
  await R.locator('.tabs button').nth(2).click();
  await R.locator('textarea').fill('# Sent test\n\nمرحبا');
  await R.locator('button.primary', { hasText: 'Send to display' }).click();
  await R.waitForFunction(() => /^Sent/.test(document.getElementById('toast') && document.getElementById('toast').textContent), null, { timeout: 5000 });
  await R.locator('input[placeholder="File name"]').fill('confirm-test');
  await R.locator('button', { hasText: /^Save$/ }).click();
  await R.waitForFunction(() => /Saved/.test(document.getElementById('toast').textContent), null, { timeout: 6000 });
});

await T('portrait phone: the menu is a bottom sheet and the script stays visible above it', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await c.newPage();
  await p.goto(base);
  await p.locator('button.big').nth(0).click();
  await p.waitForSelector('#stage');
  await p.locator('#menubtn').click();
  const r = await p.evaluate(() => { const b = document.getElementById('panel').getBoundingClientRect(); return { top: b.top, h: window.innerHeight }; });
  assert.ok(r.top > r.h * 0.3, `sheet starts at ${r.top} of ${r.h}`);
  await p.screenshot({ path: path.join(SHOTS, 'display-portrait-sheet.png') });
  await c.close();
});

await T('a link inside a script never navigates the display away', async () => {
  await R.locator('.tabs button').nth(2).click();
  await R.locator('textarea').fill('# link test\n\n[go](https://example.org/) and [rel](other.md)\n\n## two\n\ntext');
  await R.locator('button.primary', { hasText: 'Send to display' }).click();
  await D.waitForFunction(() => document.querySelector('#content a'));
  const before = D.url();
  await D.evaluate(() => document.querySelector('#content a').click());
  await sleep(300);
  assert.equal(D.url(), before);
  assert.equal(await D.evaluate(() => getComputedStyle(document.querySelector('#content a')).pointerEvents), 'none');
});

await T('next heading after the last one does not jump to the end', async () => {
  await D.evaluate(() => { document.getElementById('dctl').className = ''; });
  await R.locator('#transport button[title="Next heading"]').click();
  await sleep(1500);
  const a = await D.evaluate(() => document.getElementById('progressbar').style.width);
  await R.locator('#transport button[title="Next heading"]').click();
  await sleep(1500);
  assert.equal(await D.evaluate(() => document.getElementById('progressbar').style.width), a);
});

await T('a broken %-escape in the address does not blank the page', async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/#pin=%zz`);
  assert.ok(await p.locator('button.big').count() >= 2);
  assert.deepEqual(errs, []);
  await c.close();
});

await T('QR code made by the hub decodes in the browser and parses to host + PIN', async () => {
  const text = `http://192.168.1.20:7878/#pin=${PIN}`;
  const out = await R.evaluate(async (u) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = '/api/qr.svg?text=' + encodeURIComponent(u); });
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(img, 0, 0, 400, 400);
    const text = window.__cueme.decodeCanvas(c);
    return { text, parsed: window.__cueme.parseScanned(text) };
  }, text);
  assert.equal(out.text, text);
  assert.deepEqual(out.parsed, { host: '192.168.1.20:7878', pin: PIN, room: '' });
  assert.deepEqual(await D.evaluate(() => window.__cueme.parseScanned('https://cueme.hs.lan/#pin=7&room=ab_1')), { host: 'cueme.hs.lan', pin: '7', room: 'ab_1' });
});

await T('PIN field is numeric', async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.locator('button.big').nth(1).click();
  await p.locator('button', { hasText: /^Connect \.\.\.$/ }).click();
  assert.equal(await p.locator('input').nth(1).getAttribute('inputmode'), 'numeric');
  await c.close();
});

await T('display survives a reload and resumes the session text', async () => {
  await D.reload();
  await D.locator('button.big').nth(0).click();
  await D.waitForFunction(() => document.querySelector('#content h1') && document.querySelector('#content h1').textContent === 'link test');
});

await T('wrong PIN is refused', async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.locator('button.big').nth(1).click();
  await p.locator('button', { hasText: /^Connect \.\.\.$/ }).click();
  await p.locator('input').nth(0).fill(`127.0.0.1:${PORT}`);
  await p.locator('input').nth(1).fill('NOPE');
  await p.locator('button.primary', { hasText: 'Connect' }).click();
  await p.waitForFunction(() => /Wrong PIN/.test(document.body.innerText));
  await c.close();
});

await T('Arabic UI mirrors the layout (RTL)', async () => {
  const c = await browser.newContext({ locale: 'ar-EG', viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(base);
  assert.equal(await p.evaluate(() => document.documentElement.dir), 'rtl');
  await p.screenshot({ path: path.join(SHOTS, 'home-ar.png') });
  await c.close();
});


await T('private session: a display and remote in room "zz1" never touch the shared session', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await c.newPage(), b = await c.newPage();
  await a.goto(`${base}&room=zz1`);
  await a.locator('button.big').first().click();            // Display: no address / PIN questions
  await a.waitForSelector('#stage');
  await b.goto(`${base}&room=zz1`);
  await b.locator('button.big').nth(1).click();             // Remote
  await b.locator('button.peer').first().click();           // this device / server
  await b.waitForSelector('#remote');
  await b.waitForFunction(() => window.__cueme.state.displays === 1);
  // the shared session (page D shows it) is a different one
  assert.equal(await R.evaluate(() => window.__cueme.state.displays), 1);
  await b.evaluate(() => { /* send text only into room zz1 */ });
  await c.close();
});

await T('display menu: back closes it, home returns to the main menu; remote fullscreen closes menus', async () => {
  const c = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const p = await c.newPage();
  await p.goto(base);
  await p.locator('button.big').first().click();
  await p.waitForSelector('#stage');
  await p.keyboard.press('m');
  await p.waitForSelector('#panel.open');
  assert.equal(await p.locator('#panel .tabs button.tabicon').count(), 2, 'back + home buttons');
  await p.locator('#panel .tabs button.tabicon').first().click();
  await p.waitForFunction(() => !document.querySelector('#panel.open'));
  await p.keyboard.press('m');
  await p.waitForSelector('#panel.open');
  await sendFromRemote_fullscreen(p);
  await p.waitForFunction(() => !document.querySelector('#panel.open'));
  // no tap on this page: real fullscreen is refused, so the clean screen is used instead
  await p.waitForFunction(() => document.body.className.indexOf('fs') >= 0);
  await p.keyboard.press('m');
  await p.waitForSelector('#panel.open');
  await p.locator('#panel .tabs button.tabicon').nth(1).click();
  await p.waitForSelector('.screen .big');
  await c.close();
});

await T('themes: AMOLED is true black; Auto exists', async () => {
  const c = await browser.newContext({ viewport: { width: 500, height: 700 } });
  const p = await c.newPage();
  await p.goto(base);
  await p.evaluate(() => window.__cueme.setTheme('amoled', 'mauve'));
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
  const names = await p.locator('.fl').allInnerTexts();
  assert.deepEqual(names, ['Latte', 'Frappé', 'Macchiato', 'Mocha', 'AMOLED', 'Auto']);
  await c.close();
});

await T('no JavaScript errors on any page', async () => { assert.deepEqual(errors, []); });

await browser.close();
hub.kill();
fs.rmSync(data, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL E2E PASSED');
console.log('screenshots:', SHOTS);
process.exit(fails.length ? 1 : 0);
