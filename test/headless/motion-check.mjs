// node test/headless/motion-check.mjs <baseUrl of play.html> [outDir]
// Real-time animation check over the DevTools protocol. --virtual-time-budget cannot advance Web
// Animations, so this drives a normal headless page on the wall clock: it plays the guided M1
// board with full motion, samples the hand chip and counters, saves a film strip, checks that a
// tap speeds a sowing up, and that reduced motion finishes almost at once.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openChrome, sleep } from './cdp.mjs';

const base = process.argv[2];
const out = process.argv[3] || '.';
if (!base) { console.error('usage: motion-check.mjs <play.html url> [outDir]'); process.exit(2); }
mkdirSync(out, { recursive: true });
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };
const page = await openChrome(9337);
const { cdp, evaluate } = page;
const STATE = `(() => {
  const b = document.getElementById('b');
  if (!b) return { screen: document.querySelector('h1')?.textContent ?? '' };
  const hand = b.querySelector('.fx .hand');
  const counts = [...b.querySelectorAll('[data-slot]')].map((el) => el.querySelector('.num').textContent).join(' ');
  return { screen: document.querySelector('h1').textContent, hand: hand ? hand.textContent : null, counts, visible: document.visibilityState, err: document.getElementById('test-error')?.textContent ?? null };
})()`;

const load = (url, media) => page.load(url, media);

async function playUntil(screen, limitMs, onSample) {
  const t0 = Date.now();
  for (;;) {
    const s = await evaluate(STATE);
    if (onSample) await onSample(s, Date.now() - t0);
    if (s.err) return { ms: Date.now() - t0, s };
    if (s.screen === screen) return { ms: Date.now() - t0, s };
    if (Date.now() - t0 > limitMs) return { ms: Date.now() - t0, s, timeout: true };
    await sleep(80);
  }
}

try {
  await page.viewport(900, 700);

  // 1. Full motion: guided M1 (Y5, Y6, Y4) animates to the M2 board.
  await load(`${base}?test=1&motion=1&group=A&script=M1:auto`);
  const hands = new Set(), countsSeen = new Set(), frames = [];
  let nextShot = 0;
  const full = await playUntil('Board M2', 20000, async (s, t) => {
    if (s.hand !== null && s.hand !== undefined) hands.add(s.hand);
    if (s.counts) countsSeen.add(s.counts);
    if (t >= nextShot && frames.length < 8 && s.screen === 'Board M1') {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 190, width: 900, height: 260, scale: 1 } });
      frames.push(shot.data);
      nextShot = t + 450;
    }
  });
  check(!full.timeout && !full.s.err, `full motion: guided M1 finishes and reaches M2 (${full.ms} ms)${full.s.err ? `\n${full.s.err}` : ''}`);
  check(full.s.visible === 'visible', `headless page is visible (${full.s.visible})`);
  check(full.ms > 1500, `full motion takes real time, not instant (${full.ms} ms)`);
  check(hands.size >= 2, `the hand chip appeared with changing counts (${[...hands].join(',')})`);
  check(countsSeen.size >= 6, `board counts changed shell by shell (${countsSeen.size} distinct frames)`);
  frames.forEach((f, i) => writeFileSync(join(out, `motion-frame-${i}.png`), Buffer.from(f, 'base64')));

  // 2. Tap to speed up: the same line with a pointer press during every sowing is faster.
  await load(`${base}?test=1&motion=1&group=A&script=M1:auto`);
  const fastRun = await playUntil('Board M2', 20000, async (s) => {
    if (s.hand) {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
    }
  });
  check(!fastRun.timeout && fastRun.ms < full.ms * 0.8, `tapping speeds sowings up (${fastRun.ms} ms vs ${full.ms} ms)`);

  // 3. Reduced motion: no hops, so the guided board finishes almost at once.
  await load(`${base}?test=1&motion=1&group=A&script=M1:auto`, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const calm = await playUntil('Board M2', 5000);
  check(!calm.timeout && calm.ms < 900, `reduced motion finishes quickly (${calm.ms} ms)`);
} finally {
  await page.close();
}
console.log(`\n${failures ? `${failures} FAILED` : 'all motion checks passed'}; frames in ${out}`);
process.exit(failures ? 1 : 0);
