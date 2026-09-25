import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalHouses, makeBoard, isBurnt } from '../src/engine.mjs';
import { brute as bruteRows, greedyRef } from '../src/reference.mjs';
import { solve } from '../src/solver.mjs';
import { makeRng } from '../src/prng.mjs';

// Published rows for the engine-free reference (slot 0..6 = Y0..Y6, 8..14 = L0..L6, 'x' = burnt).
const toRows = (s, burnt) => ({
  Y: [0, 1, 2, 3, 4, 5, 6].map((i) => ((burnt >> i) & 1 ? 'x' : s[i])),
  L: [8, 9, 10, 11, 12, 13, 14].map((i) => ((burnt >> i) & 1 ? 'x' : s[i])),
});
const brute = (s, burnt) => bruteRows(toRows(s, burnt));

function tinyBoard(rng) {
  let burnt = 0;
  const nb = rng.range(0, 2);
  for (let i = 0; i < nb; i++) { const h = rng.int(14); burnt |= 1 << (h < 7 ? h : h + 1); }
  const s = new Uint8Array(16);
  const total = rng.range(1, 18);
  const yours = [0, 1, 2, 3, 4, 5, 6].filter((i) => !isBurnt(burnt, i));
  const lolas = [8, 9, 10, 11, 12, 13, 14].filter((i) => !isBurnt(burnt, i));
  // ~70% of shells on your row so extra-turn trees actually branch
  for (let k = 0; k < total; k++) s[rng.int(10) < 7 ? rng.pick(yours) : rng.pick(lolas)]++;
  return { s, burnt };
}

test('solver matches brute force on 500 random tiny boards', () => {
  const rng = makeRng('tiny-boards');
  let checked = 0, multiLine = 0, bigTrees = 0;
  while (checked < 500) {
    const { s, burnt } = tinyBoard(rng);
    if (legalHouses(s, burnt).length === 0) continue;
    const b = brute(s, burnt);
    const m = solve(s, burnt);
    assert.equal(m.par, b.par);
    assert.equal(m.perfectLines, b.perfectLines);
    assert.equal(m.sowingsMin, b.sowingsMin);
    assert.equal(m.sowingsMax, b.sowingsMax);
    assert.equal(m.positionsSearched, b.positions);
    // exact rational equality
    assert.equal(m.randomParRate.n * b.prob.den, b.prob.num * m.randomParRate.d);
    if (b.perfectLines <= 64) {
      assert.deepEqual(m.easiest.moves, b.easiest.moves);
      assert.equal(m.easiest.relaySegments, b.easiest.relaySegments);
      assert.equal(m.easiest.maxHandful, b.easiest.maxHandful);
      assert.equal(m.easiest.totalDrops, b.easiest.totalDrops);
    }
    if (b.lines > 1) multiLine++;
    if (b.positions >= 10) bigTrees++;
    checked++;
  }
  assert.ok(multiLine > 250, `only ${multiLine} boards had a real choice`);
  assert.ok(bigTrees > 50, `only ${bigTrees} boards searched >= 10 positions`);
});

function assertSame(m, b) {
  assert.equal(m.par, b.par);
  assert.equal(m.perfectLines, b.perfectLines);
  assert.equal(m.sowingsMin, b.sowingsMin);
  assert.equal(m.sowingsMax, b.sowingsMax);
  assert.equal(m.positionsSearched, b.positions);
  assert.equal(m.randomParRate.n * b.prob.den, b.prob.num * m.randomParRate.d);
  if (b.perfectLines <= 64) assert.deepEqual(m.easiest.moves, b.easiest.moves);
}

test('solver matches brute force on 200 denser your-row boards (deeper extra-turn trees)', () => {
  const rng = makeRng('dense-boards');
  let checked = 0, deep = 0;
  while (checked < 200) {
    const s = new Uint8Array(16);
    for (let h = 0; h < 7; h++) s[h] = rng.range(0, h < 3 ? 3 : 8 - h);
    for (let i = 8; i < 15; i++) s[i] = rng.range(0, 2);
    if (legalHouses(s, 0).length === 0) continue;
    const b = brute(s, 0);
    assertSame(solve(s, 0), b);
    if (b.positions >= 20) deep++;
    checked++;
  }
  assert.ok(deep > 20, `only ${deep} deep trees`);
});

test('randomParRate is in [0,1], and equals 1 whenever only one line exists', () => {
  const rng = makeRng('prob-range');
  let single = 0;
  for (let i = 0; i < 400; i++) {
    const { s, burnt } = tinyBoard(rng);
    if (legalHouses(s, burnt).length === 0) continue;
    const m = solve(s, burnt);
    const p = m.randomParRate;
    assert.ok(p.n >= 0n && p.n <= p.d, `p = ${p.n}/${p.d}`);
    assert.ok(p.n > 0n); // par is reached by at least one line
    if (brute(s, burnt).lines === 1) { assert.equal(p.n, p.d); single++; }
  }
  assert.ok(single > 10, `only ${single} single-line boards sampled`);
  // explicit single-line board: one legal house, its sowing ends the turn
  const m = solve(makeBoard([0, 0, 0, 0, 0, 0, 3], [0, 0, 0, 0, 0, 2, 0]), 0);
  assert.deepEqual(m.randomParRate, { n: 1n, d: 1n });
});

test('cap: a board over the position cap is reported, never truncated', () => {
  const b = makeBoard([3, 4, 5, 6, 2, 1, 1], [2, 3, 1, 4, 2, 3, 1]);
  const full = solve(b, 0);
  assert.ok(full.positionsSearched > 10);
  const m = solve(b, 0, { cap: 10 });
  assert.equal(m.capExceeded, true); assert.equal(m.positionsSearched, 11); assert.equal(m.par, undefined);
  const ok = solve(b, 0, { cap: full.positionsSearched }); // exactly at the cap is allowed
  assert.equal(ok.capExceeded, false); assert.equal(ok.par, full.par);
});

// Report-only baseline next to greedyGap (round-2 method verifiers: the METRICS greedy cannot see relays).
test('relay-aware greedy: Tuesday #11 of spike-a (greedy captures for 3; par 5 starts with a relay into the ulo)', () => {
  const m = solve(makeBoard([1, 1, 0, 1, 2, 0, 0], [0, 0, 0, 1, 2, 0, 4]), 0);
  assert.equal(m.par, 5);
  assert.deepEqual(m.greedyMoves, [1]); assert.equal(m.greedyScore, 3); assert.equal(m.greedyGap, 2); // METRICS greedy unchanged
  assert.deepEqual(m.relayAwareMoves, [3, 6, 1]); assert.equal(m.relayAwareScore, 5); assert.equal(m.relayAwareGap, 0);
  assert.deepEqual(m.lines.map((l) => [l.moves, l.relayExtras]), [[[3, 6, 1], 1]]);
});

test('relay-aware greedy and per-line relayExtras match the independent reference on 500 random boards', () => {
  const rng = makeRng('relay-aware');
  let checked = 0, differ = 0, relayExtraLines = 0;
  while (checked < 500) {
    const { s, burnt } = tinyBoard(rng);
    if (legalHouses(s, burnt).length === 0) continue;
    const rows = toRows(s, burnt);
    const m = solve(s, burnt);
    const ref = greedyRef(rows, { relayAware: true });
    assert.equal(m.relayAwareScore, ref.score, JSON.stringify(rows));
    assert.deepEqual(m.relayAwareMoves, ref.moves, JSON.stringify(rows));
    assert.equal(m.greedyScore, greedyRef(rows).score);
    if (m.relayAwareScore !== m.greedyScore) differ++;
    const b = brute(s, burnt);
    if (m.lines) {
      const key = (l) => `${l.moves.join(',')}:${l.relayExtras}:${l.captures}:${l.relaySegments}:${l.maxHandful}`;
      assert.deepEqual(m.lines.map(key).sort(), b.perfect.map(key).sort(), JSON.stringify(rows));
      relayExtraLines += m.lines.filter((l) => l.relayExtras > 0).length;
    }
    checked++;
  }
  assert.ok(differ > 10 && relayExtraLines > 10, `coverage differ=${differ} relayExtraLines=${relayExtraLines}`);
});
