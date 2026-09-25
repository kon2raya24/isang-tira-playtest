import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playLine, makeBoard } from '../src/engine.mjs';
import { solve } from '../src/solver.mjs';
import { toState } from '../src/helper-data.mjs';
import { boards } from '../src/build-boards.mjs';
import { DEMOS } from '../src/demos.mjs';
import { sowEvents } from '../src/events.mjs';

const at = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

test('build-play writes a self-contained play.html', () => {
  execFileSync(process.execPath, [at('src/build-play.mjs')]);
  const html = readFileSync(at('play.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /^\s*(import|export)\s/m, 'every module was inlined');
  for (const id of ['app', 'live']) assert.match(html, new RegExp(`id="${id}"`));
});

test('every board\'s perfect lines score its par, and the solver agrees', () => {
  for (const b of boards) {
    const { s, burnt } = toState(b.board);
    for (const l of b.lines) assert.equal(playLine(s, burnt, l.moves.map((m) => Number(m.slice(1)))).score, b.par, `${b.code} ${l.moves}`);
    assert.equal(solve(s, burnt).par, b.par, `${b.code} solver par`);
  }
});

test('start-screen demos teach one rule each, and none is a relay into the ulo', () => {
  for (const d of DEMOS) {
    const { result } = sowEvents(makeBoard(d.Y, d.L), 0, d.house);
    assert.equal(result.outcome, d.outcome, d.caption);
    assert.equal(result.relays, d.relays, d.caption);
    assert.ok(!(result.outcome === 'extra' && result.relays > 0), 'no relay-into-ulo demo');
  }
});

test('the rules say that a capture or a dud ends the turn', () => {
  const html = readFileSync(at('play.html'), 'utf8');
  assert.match(html, /Nothing opposite\? A dud\. Either way, the turn ends\./, 'rule card 4');
  assert.match(DEMOS.find((d) => d.outcome === 'capture').caption, /turn ends/, 'capture demo caption');
  assert.match(html, /capture: 'Your last shell landed in your own empty house, so you capture the Lola house opposite, plus that shell, and the turn ends\.'/, 'guided capture lesson');
});

test('index.html is accurate about where answers appear', () => {
  const idx = readFileSync(at('index.html'), 'utf8');
  assert.doesNotMatch(idx, /The answer key isn't online\./);
  assert.match(idx, /perfect lines only after all ten boards/);
});

test('text colours meet WCAG AA 4.5:1 on the backgrounds they sit on', () => {
  const css = readFileSync(at('src/play/style.css'), 'utf8');
  const v = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [['ink', 'paper'], ['ink', 'ground'], ['ink', 'wood'], ['muted', 'paper'], ['muted', 'ground'], ['muted', 'wood'],
    ['ok', 'paper'], ['ok', 'ground'], ['no', 'paper'], ['no', 'ground'], ['paper', 'line']];
  for (const [fg, bg] of pairs) assert.ok(ratio(v[fg], v[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(v[fg], v[bg]).toFixed(2)}:1`);
  for (const bg of ['fh', 'ws']) assert.ok(ratio('#ffffff', v[bg]) >= 4.5, `white on ${bg}: ${ratio('#ffffff', v[bg]).toFixed(2)}:1`);
});
