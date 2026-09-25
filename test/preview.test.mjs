import test from 'node:test';
import assert from 'node:assert/strict';
import { ULO, nextTable, legalHouses, sow, makeBoard, burntMask } from '../src/engine.mjs';
import { firstHandful, firstHandfulText, wholeSowing, wholeSowingText, slotName } from '../src/preview.mjs';
import { boards } from '../src/build-boards.mjs';
import { toState } from '../src/helper-data.mjs';

// Every decision state reachable from a board, via the engine.
function reachable(s0, burnt) {
  const next = nextTable(burnt), seen = new Map(), stack = [s0];
  while (stack.length) {
    const s = stack.pop(), k = s.slice(0, 15).join(',');
    if (seen.has(k)) continue;
    seen.set(k, s);
    for (const h of legalHouses(s, burnt)) {
      const r = sow(s, burnt, h, next);
      if (r.outcome === 'extra') stack.push(r.state);
    }
  }
  return [...seen.values()];
}

function checkState(s, burnt) {
  const next = nextTable(burnt);
  for (const h of legalHouses(s, burnt)) {
    const r = sow(s, burnt, h, next);
    const f = firstHandful(s, burnt, h, next);
    const w = wholeSowing(s, burnt, h, next);
    assert.equal(f.size, s[h]);
    assert.equal(w.stops.length, r.handfuls.length);
    assert.equal(w.stops.at(-1), r.last);
    if (r.relays === 0) {
      assert.equal(f.meaning, r.outcome, `first handful = whole sowing when no relay (${h})`);
      assert.equal(f.lands, r.last);
      if (r.outcome === 'capture') assert.equal(f.oppShells + 1, r.captured);
      if (r.outcome === 'extra' || r.outcome === 'capture') assert.ok(r.gained >= 1);
    } else {
      assert.equal(f.meaning, 'relay');
      assert.equal(f.lands, w.stops[0]);
    }
    for (const t of [firstHandfulText(f), wholeSowingText(w)]) assert.doesNotMatch(t, /undefined|NaN|null/);
  }
}

test('previews agree with the engine at every reachable decision of all 10 pack boards', () => {
  let states = 0;
  for (const b of boards) {
    const { s, burnt } = toState(b.board);
    for (const x of reachable(s, burnt)) { checkState(x, burnt); states++; }
  }
  assert.ok(states > 10);
});

test('opening first-handful previews match the answer-key crib (computed separately in pick-boards.mjs)', () => {
  for (const b of boards) {
    const { s, burnt } = toState(b.board);
    for (const o of b.opening) {
      const h = Number(o.house.slice(1));
      const f = firstHandful(s, burnt, h);
      assert.equal(f.size, o.size, `${b.code} ${o.house} size`);
      assert.equal(slotName(f.lands), o.lands === 'ulo' ? 'your ulo' : o.lands, `${b.code} ${o.house} lands`);
      assert.equal(f.meaning, o.meaning, `${b.code} ${o.house} meaning`);
      assert.equal(f.passUlo, o.passUlo, `${b.code} ${o.house} passUlo`);
    }
    assert.equal(b.opening.length, legalHouses(s, burnt).length, `${b.code} crib covers every legal house`);
  }
});

test('previews agree with the engine on 3,000 random boards with burnt houses', () => {
  let seed = 12345;
  let laps = 0;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  for (let t = 0; t < 3000; t++) {
    const Y = [], L = [], bY = [], bL = [];
    for (let i = 0; i < 7; i++) {
      const v = () => (rnd(20) === 0 ? 14 + rnd(8) : rnd(3) ? rnd(9) : 0); // 1 in 20 houses big enough to lap
      if (rnd(8) === 0) bY.push(i); else Y[i] = v();
      if (rnd(8) === 0) bL.push(i); else L[i] = v();
    }
    const burnt = burntMask({ Y: bY, L: bL });
    const s = makeBoard(Y.map((v, i) => (bY.includes(i) ? 0 : v || 0)), L.map((v, i) => (bL.includes(i) ? 0 : v || 0)));
    if (legalHouses(s, burnt).length) checkState(s, burnt);
    for (const h of legalHouses(s, burnt)) if (s[h] >= 14) laps++;
  }
  assert.ok(laps > 100, `exercised ${laps} lapping handfuls`);
});

test('hand-traced: board W1 opening, Y2 (3 shells)', () => {
  // Y[1 1 3 0 0 1 0] L[4 1 0 0 2 0 3]. Y2's 3 shells drop Y3, Y4, Y5; Y5 had 1 -> relay 2: Y6, ulo -> extra, +1.
  const w1 = boards.find((b) => b.code === 'W1');
  const { s, burnt } = toState(w1.board);
  assert.equal(firstHandfulText(firstHandful(s, burnt, 2)), 'It ends in Y5, which already has shells: relay.');
  assert.equal(wholeSowingText(wholeSowing(s, burnt, 2)), 'It relays at Y5, then ends in your ulo: extra turn. This sowing adds 1 to your ulo.');
  // Y5's 1 shell -> Y6 (empty) opposite L0 has 4 -> capture 5.
  assert.equal(firstHandfulText(firstHandful(s, burnt, 5)), "It ends in your empty Y6; L0 opposite has 4: you'd capture 5.");
  assert.equal(wholeSowingText(wholeSowing(s, burnt, 5)), 'It ends in your empty Y6; L0 opposite had 4: capture 5, the turn ends. This sowing adds 5 to your ulo.');
  assert.equal(ULO, 7);
});
