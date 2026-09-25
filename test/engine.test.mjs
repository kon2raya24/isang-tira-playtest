import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sow, turnEnd, playLine, makeBoard, burntMask, nextTable, distanceToUlo, loopLength,
  legalHouses, housesTotal, ULO, LOLA_ULO, isBurnt,
} from '../src/engine.mjs';
import { solve, greedyLine } from '../src/solver.mjs';
import { makeRng } from '../src/prng.mjs';

const rows = (s) => ({ Y: Array.from(s.slice(0, 7)), ulo: s[ULO], L: Array.from(s.slice(8, 15)) });

// ---------------------------------------------------------------------------
// HAND-TRACED GOLDEN POSITIONS. Notation: Y = [Y0..Y6], L = [L0..L6].
// Path: Y0..Y6 -> ulo -> L0..L6 -> Y0 (Lola ulo and burnt houses skipped).
// ---------------------------------------------------------------------------

test('G1 extra-turn chain (Tchoukaillon style) and its solver metrics', () => {
  // Y=[0,0,0,0,0,2,1] L=[0,0,0,5,0,0,0]
  // sow Y6: lift 1 -> ulo(1). Last in ulo -> EXTRA, gained 1.
  // sow Y5: lift 2 -> Y6(0->1), ulo(2). EXTRA, gained 1.
  // sow Y6: lift 1 -> ulo(3). EXTRA; no legal house left -> turn ends. L3=5 so no sweep. Score 3.
  // Alternative [5,6]: Y5: 2 -> Y6(1->2), ulo -> EXTRA(1); Y6: 2 -> ulo, L0(empty) -> END(1). Score 2.
  // So par 3, one perfect line [6,5,6], random play: 1/2 at the root then forced -> 1/2.
  // Greedy: both Y6 (1 shell, dist 1) and Y5 (2 shells, dist 2) end exactly in ulo -> nearest = Y6; then Y5; then Y6 -> 3.
  const b = makeBoard([0, 0, 0, 0, 0, 2, 1], [0, 0, 0, 5, 0, 0, 0]);
  let r = sow(b, 0, 6);
  assert.equal(r.outcome, 'extra'); assert.equal(r.gained, 1); assert.equal(r.drops, 1);
  r = sow(r.state, 0, 5);
  assert.equal(r.outcome, 'extra'); assert.equal(r.gained, 1);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 0, 0, 0, 1], ulo: 2, L: [0, 0, 0, 5, 0, 0, 0] });
  r = sow(r.state, 0, 6);
  assert.equal(r.outcome, 'extra');
  assert.deepEqual(legalHouses(r.state, 0), []);
  assert.equal(playLine(b, 0, [6, 5, 6]).score, 3);
  assert.equal(playLine(b, 0, [5, 6]).score, 2);
  const m = solve(b, 0);
  assert.equal(m.par, 3); assert.equal(m.perfectLines, 1);
  assert.equal(m.sowingsMin, 3); assert.equal(m.sowingsMax, 3);
  assert.deepEqual(m.easiest.moves, [6, 5, 6]);
  assert.deepEqual(m.randomParRate, { n: 1n, d: 2n });
  assert.equal(m.greedyScore, 3); assert.deepEqual(m.greedyMoves, [6, 5, 6]);
});

test('G2 relay onto Lola side', () => {
  // Y=[0,0,0,0,0,3,0] L=[2,0,0,0,0,1,0]
  // sow Y5: lift 3 -> Y6(0->1), ulo(1), L0(2->3, was non-empty) -> RELAY: lift 3 from L0
  //   -> L1(0->1), L2(0->1), L3(0->1, was empty, Lola house) -> END.
  // gained 1, drops 6, handfuls [3,3], relays 1.
  const b = makeBoard([0, 0, 0, 0, 0, 3, 0], [2, 0, 0, 0, 0, 1, 0]);
  const r = sow(b, 0, 5);
  assert.equal(r.outcome, 'end'); assert.equal(r.gained, 1); assert.equal(r.drops, 6);
  assert.deepEqual(r.handfuls, [3, 3]); assert.equal(r.relays, 1); assert.equal(r.last, 8 + 3);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 0, 0, 0, 1], ulo: 1, L: [0, 1, 1, 1, 0, 1, 0] });
});

test('G3 relay back onto your side, then capture', () => {
  // Y=[2,0,0,0,0,0,9] L=[0,0,0,0,0,0,0]
  // sow Y6: lift 9 -> ulo(1), L0..L6 each 0->1 (7 drops), Y0(2->3, non-empty) -> RELAY: lift 3 from Y0
  //   -> Y1(1), Y2(1), Y3(0->1, was empty, your house). Opposite of Y3 is L3 = 1 -> CAPTURE 1 + 1 = 2.
  // gained 1 + 2 = 3, drops 9 + 3 = 12, handfuls [9,3], relays 1.
  const b = makeBoard([2, 0, 0, 0, 0, 0, 9], [0, 0, 0, 0, 0, 0, 0]);
  const r = sow(b, 0, 6);
  assert.equal(r.outcome, 'capture'); assert.equal(r.gained, 3); assert.equal(r.captured, 2);
  assert.equal(r.drops, 12); assert.deepEqual(r.handfuls, [9, 3]); assert.equal(r.relays, 1);
  assert.deepEqual(rows(r.state), { Y: [0, 1, 1, 0, 0, 0, 0], ulo: 3, L: [1, 1, 1, 0, 1, 1, 1] });
});

test('G4 capture moves the opposite house PLUS the capturing shell', () => {
  // Y=[0,0,1,0,0,0,0] L=[1,0,0,4,0,0,0]
  // sow Y2: lift 1 -> Y3(0->1, was empty). Opposite L3 = 4 -> CAPTURE 4 + 1 = 5; Y3 and L3 emptied.
  // Turn end: L0 = 1 so no sweep. Score 5.
  const b = makeBoard([0, 0, 1, 0, 0, 0, 0], [1, 0, 0, 4, 0, 0, 0]);
  const r = sow(b, 0, 2);
  assert.equal(r.outcome, 'capture'); assert.equal(r.captured, 5); assert.equal(r.gained, 5);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 0, 0, 0, 0], ulo: 5, L: [1, 0, 0, 0, 0, 0, 0] });
  assert.equal(turnEnd(r.state, 0).swept, 0);
  assert.equal(playLine(b, 0, [2]).score, 5);
});

test('G5 dud: empty your house with an empty opposite', () => {
  // Y=[0,0,1,0,0,0,0] L=[3,0,0,0,0,0,0]
  // sow Y2: lift 1 -> Y3(0->1, was empty). Opposite L3 = 0 -> DUD: shell stays in Y3, nothing captured.
  const b = makeBoard([0, 0, 1, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0]);
  const r = sow(b, 0, 2);
  assert.equal(r.outcome, 'dud'); assert.equal(r.gained, 0); assert.equal(r.captured, 0);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 1, 0, 0, 0], ulo: 0, L: [3, 0, 0, 0, 0, 0, 0] });
  assert.equal(playLine(b, 0, [2]).score, 0);
});

test('G6 dud: empty your house with a burnt opposite', () => {
  // burnt L3. Y=[0,0,1,0,0,0,0] L=[3,0,0,x,0,0,0]
  // sow Y2: lift 1 -> Y3(0->1, was empty). Opposite L3 is burnt -> DUD.
  const burnt = burntMask({ L: [3] });
  const b = makeBoard([0, 0, 1, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0]);
  const r = sow(b, burnt, 2);
  assert.equal(r.outcome, 'dud'); assert.equal(r.gained, 0);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 1, 0, 0, 0], ulo: 0, L: [3, 0, 0, 0, 0, 0, 0] });
});

test('G7 last shell in an empty Lola house ends the turn', () => {
  // Y=[0,0,0,0,0,0,3] L=[0,0,0,0,0,2,0]
  // sow Y6: lift 3 -> ulo(1), L0(0->1), L1(0->1, was empty, Lola) -> END. gained 1. L5=2 so no sweep.
  const b = makeBoard([0, 0, 0, 0, 0, 0, 3], [0, 0, 0, 0, 0, 2, 0]);
  const r = sow(b, 0, 6);
  assert.equal(r.outcome, 'end'); assert.equal(r.gained, 1); assert.equal(r.drops, 3); assert.equal(r.last, 9);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 0, 0, 0, 0], ulo: 1, L: [1, 1, 0, 0, 0, 2, 0] });
  assert.equal(playLine(b, 0, [6]).score, 1);
});

test('G8 a 15-shell handful laps and lands in its own (emptied) origin house', () => {
  // Y=[0,0,0,15,0,0,0], everything else 0. Loop has 15 slots.
  // sow Y3: Y4,Y5,Y6 (3) + ulo (1) + L0..L6 (7) + Y0,Y1,Y2 (3) = 14 drops; drop 15 lands in Y3,
  // which was emptied by the lift -> empty before this drop -> opposite L3 got 1 on the lap -> CAPTURE 1 + 1 = 2.
  // gained 1 + 2 = 3, drops 15, no relay.
  const b = makeBoard([0, 0, 0, 15, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]);
  const r = sow(b, 0, 3);
  assert.equal(r.outcome, 'capture'); assert.equal(r.last, 3);
  assert.equal(r.gained, 3); assert.equal(r.drops, 15); assert.equal(r.relays, 0); assert.equal(r.captured, 2);
  assert.deepEqual(rows(r.state), { Y: [1, 1, 1, 0, 1, 1, 1], ulo: 3, L: [1, 1, 1, 0, 1, 1, 1] });
});

test('G8b a 17-shell handful drops into its own origin mid-lap, then relays into the ulo', () => {
  // Y=[0,0,0,17,0,0,0]. Drops 1-14 as in G8; drop 15 -> Y3 (0->1, origin receives a shell: no skip);
  // drop 16 -> Y4 (1->2); drop 17 -> Y5 (1->2, was non-empty) -> RELAY: lift 2 -> Y6(1->2), ulo(1->2) -> EXTRA.
  // gained 2, drops 19, handfuls [17,2], relays 1.
  const b = makeBoard([0, 0, 0, 17, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]);
  const r = sow(b, 0, 3);
  assert.equal(r.outcome, 'extra'); assert.equal(r.gained, 2); assert.equal(r.drops, 19);
  assert.deepEqual(r.handfuls, [17, 2]); assert.equal(r.relays, 1);
  assert.deepEqual(rows(r.state), { Y: [1, 1, 1, 1, 2, 0, 2], ulo: 2, L: [1, 1, 1, 1, 1, 1, 1] });
});

test('G9 burnt houses on both sides are skipped and distances shift', () => {
  // burnt Y5 and L1. Loop = 13 slots. distance(Y4 -> ulo) = 2 (Y6, ulo) instead of 3.
  const burnt = burntMask({ Y: [5], L: [1] });
  assert.equal(loopLength(burnt), 13);
  assert.equal(distanceToUlo(burnt, 4), 2); assert.equal(distanceToUlo(0, 4), 3);
  assert.equal(distanceToUlo(burnt, 0), 6);
  // (a) Y=[0,0,0,0,2,x,0] L=[1,x,0,0,0,0,0]: sow Y4: 2 -> Y6(1), ulo(1) -> EXTRA (Y5 skipped).
  let r = sow(makeBoard([0, 0, 0, 0, 2, 0, 0], [1, 0, 0, 0, 0, 0, 0]), burnt, 4);
  assert.equal(r.outcome, 'extra'); assert.equal(r.gained, 1); assert.equal(r.drops, 2);
  assert.deepEqual(rows(r.state), { Y: [0, 0, 0, 0, 0, 0, 1], ulo: 1, L: [1, 0, 0, 0, 0, 0, 0] });
  // (b) Y=[0,0,0,0,0,x,9] L=[0,x,0,0,0,0,0]: sow Y6: 9 -> ulo(1), L0, [L1 skipped], L2, L3, L4, L5, L6 (6 drops),
  //   Y0(1), Y1(0->1, was empty) = 9 drops. Opposite of Y1 is L5 = 1 -> CAPTURE 2. gained 3.
  //   (Unburnt, the 9th shell would land in Y0 instead.)
  r = sow(makeBoard([0, 0, 0, 0, 0, 0, 9], [0, 0, 0, 0, 0, 0, 0]), burnt, 6);
  assert.equal(r.outcome, 'capture'); assert.equal(r.last, 1); assert.equal(r.gained, 3); assert.equal(r.drops, 9);
  assert.deepEqual(rows(r.state), { Y: [1, 0, 0, 0, 0, 0, 0], ulo: 3, L: [1, 0, 1, 1, 1, 0, 1] });
  const u = sow(makeBoard([0, 0, 0, 0, 0, 0, 9], [0, 0, 0, 0, 0, 0, 0]), 0, 6);
  assert.equal(u.last, 0);
  // burnt houses can never be chosen
  assert.throws(() => sow(makeBoard([0, 0, 0, 0, 0, 0, 1], []), burnt, 5));
});

test('G10 mandatory extra turn with no legal house ends the turn', () => {
  // Y=[0,0,0,0,0,0,1] L=[0,0,2,0,0,0,0]
  // sow Y6: 1 -> ulo -> EXTRA (mandatory), but no non-empty house remains -> turn ends. L2=2 so no sweep. Score 1.
  // Only one decision line exists -> randomParRate = 1.
  const b = makeBoard([0, 0, 0, 0, 0, 0, 1], [0, 0, 2, 0, 0, 0, 0]);
  const r = sow(b, 0, 6);
  assert.equal(r.outcome, 'extra'); assert.deepEqual(legalHouses(r.state, 0), []);
  assert.equal(playLine(b, 0, [6]).score, 1);
  const m = solve(b, 0);
  assert.equal(m.par, 1); assert.equal(m.perfectLines, 1); assert.equal(m.sowingsMin, 1);
  assert.deepEqual(m.randomParRate, { n: 1n, d: 1n });
  assert.equal(m.positionsSearched, 2); // root + the empty extra-turn state
});

test('G10b the extra turn is mandatory even when stopping would be better', () => {
  // Y=[0,0,0,0,5,0,1] L all 0.
  // [6]: Y6 1 -> ulo EXTRA (1). Forced: Y4 5 -> Y5(1), Y6(0->1), ulo(2), L0(1), L1(0->1, empty Lola) -> END (+1).
  //      Lola row now non-empty -> no sweep. Score 2. (If stopping after [6] were allowed, the sweep would give 6.)
  // [4]: Y4 5 -> Y5(1), Y6(1->2), ulo(1), L0(1), L1(1) -> END. Score 1.
  // par 2, one perfect line [6,4], random 1/2.
  const b = makeBoard([0, 0, 0, 0, 5, 0, 1], [0, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => playLine(b, 0, [6]), /mandatory/);
  assert.equal(playLine(b, 0, [6, 4]).score, 2);
  assert.equal(playLine(b, 0, [4]).score, 1);
  const m = solve(b, 0);
  assert.equal(m.par, 2); assert.equal(m.perfectLines, 1);
  assert.deepEqual(m.easiest.moves, [6, 4]);
  assert.deepEqual(m.randomParRate, { n: 1n, d: 2n });
});

test('G11 sweep triggered after a capture empties the Lola row', () => {
  // Y=[0,0,1,0,0,0,4] L=[0,0,0,2,0,0,0]
  // sow Y2: 1 -> Y3 (empty) -> opposite L3 = 2 -> CAPTURE 3. Turn ends; every Lola house empty ->
  // SWEEP Y6's 4 into ulo. Score 3 + 4 = 7.
  const b = makeBoard([0, 0, 1, 0, 0, 0, 4], [0, 0, 0, 2, 0, 0, 0]);
  const r = sow(b, 0, 2);
  assert.equal(r.outcome, 'capture'); assert.equal(r.gained, 3);
  const t = turnEnd(r.state, 0);
  assert.equal(t.swept, 4);
  assert.deepEqual(rows(t.state), { Y: [0, 0, 0, 0, 0, 0, 0], ulo: 7, L: [0, 0, 0, 0, 0, 0, 0] });
  assert.equal(playLine(b, 0, [2]).score, 7);
});

test('G12 sweep not triggered while a Lola house still holds a shell', () => {
  // Same as G11 plus L0 = 1: capture 3, Lola row not empty -> no sweep. Score 3.
  const b = makeBoard([0, 0, 1, 0, 0, 0, 4], [1, 0, 0, 2, 0, 0, 0]);
  const r = sow(b, 0, 2);
  assert.equal(turnEnd(r.state, 0).swept, 0);
  assert.equal(playLine(b, 0, [2]).score, 3);
  // Sweep with a burnt Lola house (burnt counts as empty): burnt L0, then the same capture sweeps 4.
  const burnt = burntMask({ L: [0] });
  assert.equal(playLine(makeBoard([0, 0, 1, 0, 0, 0, 4], [0, 0, 0, 2, 0, 0, 0]), burnt, [2]).score, 7);
});

test('G13 relay that ends in the ulo is an extra turn, but not an "exact" first handful for greedy', () => {
  // Y=[0,0,0,0,1,1,0] L=[0,0,1,0,0,0,0]
  // sow Y4: 1 -> Y5(1->2, non-empty) -> RELAY lift 2 -> Y6(1), ulo(1) -> EXTRA. gained 1, handfuls [1,2].
  // Greedy at root: no first handful ends in ulo (Y4 ends in Y5; Y5 ends in Y6 = empty -> dud vs L0 = 0).
  //   bank(Y4) = 1, bank(Y5) = 0 (dud, Lola non-empty so no sweep) -> Y4.
  //   Then Y6 = 1 is exact -> EXTRA; nothing left -> turn ends. Greedy score 2.
  const b = makeBoard([0, 0, 0, 0, 1, 1, 0], [0, 0, 1, 0, 0, 0, 0]);
  const r = sow(b, 0, 4);
  assert.equal(r.outcome, 'extra'); assert.equal(r.relays, 1); assert.deepEqual(r.handfuls, [1, 2]);
  const g = greedyLine(b, 0);
  assert.deepEqual(g.moves, [4, 6]); assert.equal(g.score, 2);
});

// ---------------------------------------------------------------------------
// Invariants over random sowings
// ---------------------------------------------------------------------------

function randomCase(rng) {
  let burnt = 0;
  const nb = rng.range(0, 4);
  for (let i = 0; i < nb; i++) { const h = rng.int(14); burnt |= 1 << (h < 7 ? h : h + 1); }
  const s = new Uint8Array(16);
  s[ULO] = rng.range(0, 20); s[LOLA_ULO] = rng.range(0, 20);
  for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]) {
    if (isBurnt(burnt, i)) continue;
    s[i] = rng.range(0, 6);
  }
  // 1 in 5: one of your houses gets a lapping handful (totals stay far below the Uint8 limit).
  if (rng.int(5) === 0) { const h = rng.int(7); if (!isBurnt(burnt, h)) s[h] = rng.range(13, 60); }
  return { s, burnt };
}

test('shell conservation over 20000 random sowings (including sweep)', () => {
  const rng = makeRng('conservation');
  let n = 0;
  while (n < 20000) {
    const { s, burnt } = randomCase(rng);
    const legal = legalHouses(s, burnt);
    if (!legal.length) continue;
    const before = housesTotal(s) + s[ULO];
    const r = sow(s, burnt, rng.pick(legal));
    assert.equal(housesTotal(r.state) + r.state[ULO], before);
    assert.equal(r.state[ULO] - s[ULO], r.gained);
    assert.equal(r.state[LOLA_ULO], s[LOLA_ULO]);
    for (let i = 0; i < 15; i++) if (isBurnt(burnt, i)) assert.equal(r.state[i], 0);
    assert.equal(r.handfuls.length, r.relays + 1);
    assert.equal(r.drops, r.handfuls.reduce((a, b) => a + b, 0));
    const t = turnEnd(r.state, burnt);
    assert.equal(housesTotal(t.state) + t.state[ULO], before);
    n++;
  }
});

test('R8 bound: drops <= 15 x shells in houses, never fires, over 20000 random sowings', () => {
  const rng = makeRng('r8');
  let n = 0, maxRatio = 0;
  while (n < 20000) {
    const { s, burnt } = randomCase(rng);
    const legal = legalHouses(s, burnt);
    if (!legal.length) continue;
    const bound = 15 * housesTotal(s);
    const r = sow(s, burnt, rng.pick(legal)); // sow() itself throws if the bound is exceeded
    assert.ok(r.drops <= bound);
    maxRatio = Math.max(maxRatio, r.drops / housesTotal(s));
    n++;
  }
  assert.ok(maxRatio <= 15);
});

test('nextTable skips Lola ulo and burnt houses', () => {
  const next = nextTable(0);
  assert.equal(next[6], ULO); assert.equal(next[ULO], 8); assert.equal(next[14], 0); assert.equal(next[LOLA_ULO], -1);
  const nb = nextTable(burntMask({ Y: [0], L: [6] }));
  assert.equal(nb[13], 1);
  assert.throws(() => nextTable(1 << ULO));
});
