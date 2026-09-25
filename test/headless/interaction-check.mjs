// node test/headless/interaction-check.mjs <play.html url>
// Keyboard, focus, announcement, confirmation and phone-layout checks, driven on the wall clock
// over the DevTools protocol (see cdp.mjs).
import { openChrome, sleep } from './cdp.mjs';
import { fullScript } from './script.mjs';

const base = process.argv[2];
if (!base) { console.error('usage: interaction-check.mjs <play.html url>'); process.exit(2); }
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };
const ENTER = { code: 'Enter', keyCode: 13, text: '\r' };
const META = 4;
const page = await openChrome(9338);
const q = (js) => page.evaluate(js);
const focusDesc = () => q(`(() => { const a = document.activeElement; return a ? (a.getAttribute('role') || a.tagName.toLowerCase()) + (a.className ? '.' + a.className : '') + (a.dataset && a.dataset.tick ? ':' + a.dataset.tick : '') : 'none'; })()`);
const ticksShown = () => q(`document.querySelectorAll('[data-act="tick"]').length`);

try {
  await page.viewport(1000, 800);

  // 1. After a try, focus sits on the tick question, so a stray Enter chooses nothing.
  await page.load(`${base}?test=1&group=A&script=${encodeURIComponent('M1:auto;M2:462')}`);
  await sleep(300);
  check(/^group\.ticks/.test(await focusDesc()), `after a try, focus is on the tick group (${await focusDesc()})`);
  await page.key('Enter', ENTER);
  await sleep(100);
  check((await ticksShown()) === 3, 'a stray Enter on the tick group records nothing');
  await page.key('1', { code: 'Digit1', keyCode: 49, text: '1' });
  await sleep(100);
  check(/^group\.ticks/.test(await focusDesc()), `a digit outside play leaves focus on the ticks (${await focusDesc()})`);

  // 2. A held (auto-repeating) Enter never activates a tick; a real press still does.
  await q(`document.querySelector('[data-act="tick"]').focus()`);
  await page.key('Enter', { ...ENTER, autoRepeat: true });
  await sleep(100);
  check((await ticksShown()) === 3, 'an auto-repeated Enter on "Worked it out" records nothing');
  await page.key('Enter', ENTER);
  await sleep(100);
  check((await ticksShown()) === 0 && (await q(`!!document.querySelector('[data-act="next"]')`)), 'a deliberate Enter still records the tick');

  // 3. Screen readers hear each new board; modifier+digit does nothing; a plain digit still works.
  await page.load(`${base}?test=1&group=A&script=M1:auto`);
  await sleep(300);
  const live = await q(`document.getElementById('live').textContent`);
  check(live === 'Board M2, Monday. Par 6. Preview: first handful only. Try 1 of 3.', `the new board is announced ("${live}")`);
  await page.key('1', { code: 'Digit1', keyCode: 49, modifiers: META });
  await sleep(100);
  check(!(await q(`!!document.querySelector('#b .h.sel')`)), 'Meta+1 (a browser tab shortcut) selects nothing');
  await page.key('1', { code: 'Digit1', keyCode: 49, text: '1' });
  await sleep(100);
  check(await q(`!!document.querySelector('#b [data-slot="0"].sel')`), 'a plain 1 still previews Y0');

  // 4. Results: focus moves to the heading; a double-click on Start over does not erase progress.
  await page.load(`${base}?test=1&group=A&prefer=ws&why=x&script=${encodeURIComponent(fullScript)}`);
  await sleep(500);
  check((await q(`document.activeElement.tagName`)) === 'H1', `the results screen focuses its heading (${await focusDesc()})`);
  await page.clickSelector('[data-act="restart"]', 1);
  await sleep(60);
  await page.clickSelector('[data-act="restart"]', 2);
  await sleep(150);
  check((await q(`document.querySelector('h1').textContent`)) === 'Your results', 'a double-click on Start over keeps the results');
  await sleep(700);
  await page.clickSelector('[data-act="restart"]', 1);
  await sleep(150);
  check((await q(`document.querySelector('h1').textContent`)) === 'Isang Tira', 'a deliberate second tap on Start over does erase');

  // 5. Phone, full motion: the hand chip keeps off the counts, and nothing scrolls sideways.
  await page.viewport(360, 800, true);
  await page.load(`${base}?test=1&motion=1&group=A&script=M1:auto`);
  let worstCover = 0, sideways = 0, samples = 0, stampOut = 0, stamps = 0, stampCover = 0;
  for (const t0 = Date.now(); Date.now() - t0 < 8000;) {
    const m = await q(`(() => {
      const hand = document.querySelector('#b .fx .hand:not(.take)');
      const de = document.documentElement;
      let cover = 0;
      if (hand) {
        const h = hand.getBoundingClientRect();
        for (const num of document.querySelectorAll('#b .h .num, #b .ulo .num')) {
          const n = num.getBoundingClientRect();
          const w = Math.max(0, Math.min(h.right, n.right) - Math.max(h.left, n.left));
          const t = Math.max(0, Math.min(h.bottom, n.bottom) - Math.max(h.top, n.top));
          if (n.width * n.height) cover = Math.max(cover, (w * t) / (n.width * n.height));
        }
      }
      const stamp = document.querySelector('#b .fx .stamp');
      let out = false, scover = 0;
      if (stamp) {
        const r = stamp.getBoundingClientRect(), b = document.getElementById('b').getBoundingClientRect();
        out = r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1;
        const n = document.querySelector('#b .ulo .num').getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, n.right) - Math.max(r.left, n.left));
        const t = Math.max(0, Math.min(r.bottom, n.bottom) - Math.max(r.top, n.top));
        scover = (w * t) / (n.width * n.height);
      }
      return { hand: !!hand, cover, stamp: !!stamp, out, scover, sideways: de.scrollWidth > de.clientWidth, screen: document.querySelector('h1')?.textContent };
    })()`);
    samples++;
    if (m.hand) worstCover = Math.max(worstCover, m.cover);
    if (m.sideways) sideways++;
    if (m.stamp) { stamps++; if (m.out) stampOut++; stampCover = Math.max(stampCover, m.scover); }
    if (m.screen === 'Board M2') break;
    await sleep(50);
  }
  check(worstCover <= 0.25, `at 360 px the hand chip covers at most a quarter of any count (worst ${(worstCover * 100).toFixed(0)}%)`);
  check(stamps > 0 && stampOut === 0, `at 360 px the ISA PA! stamp stays inside the board (${stampOut} of ${stamps} stamp samples outside)`);
  check(stampCover <= 0.25, `at 360 px the ISA PA! stamp keeps off the ulo total (worst ${(stampCover * 100).toFixed(0)}%)`);
  check(sideways === 0, `at 360 px the page never scrolls sideways during sowings (${sideways} of ${samples} samples)`);
} finally {
  await page.close();
}
console.log(`\n${failures ? `${failures} FAILED` : 'all interaction checks passed'}`);
process.exit(failures ? 1 : 0);
