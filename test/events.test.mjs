import test from 'node:test';
import assert from 'node:assert/strict';
import { ULO, nextTable, legalHouses, sow, turnEnd, makeBoard, burntMask } from '../src/engine.mjs';
import { sowEvents, turnEndEvents, applyEvent } from '../src/events.mjs';
import { stepMs, sowingMs } from '../src/timing.mjs';
import { boards } from '../src/build-boards.mjs';
import { toState } from '../src/helper-data.mjs';

const replay = (state, events) => {
  const s = Uint8Array.from(state);
  for (const e of events) applyEvent(s, e);
  return s;
};

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
    const { events, result } = sowEvents(s, burnt, h, next);
    assert.deepEqual(result, sow(s, burnt, h, next), 'result is sow() verbatim');
    assert.deepEqual([...replay(s, events)], [...result.state], `replay equals the engine state (house ${h})`);
    assert.equal(events.filter((e) => e.t === 'drop').length, result.drops);
    assert.equal(events.filter((e) => e.t === 'lift' || e.t === 'relay').length, result.handfuls.length);
    assert.equal(events[0].t, 'lift');
    assert.equal(events.at(-1).t, result.outcome);
    if (result.outcome === 'capture') assert.equal(events.at(-1).n, result.captured);
  }
}

test('events replay to the engine state at every reachable decision of all 10 pack boards', () => {
  let states = 0;
  for (const b of boards) {
    const { s, burnt } = toState(b.board);
    for (const x of reachable(s, burnt)) { checkState(x, burnt); states++; }
  }
  assert.ok(states > 10);
});

test('events replay to the engine state on 3,000 random boards with burnt houses and laps', () => {
  let seed = 424242, laps = 0;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  for (let t = 0; t < 3000; t++) {
    const Y = [], L = [], bY = [], bL = [];
    const v = () => (rnd(20) === 0 ? 14 + rnd(8) : rnd(3) ? rnd(9) : 0);
    for (let i = 0; i < 7; i++) {
      if (rnd(8) === 0) { bY.push(i); Y[i] = 0; } else Y[i] = v();
      if (rnd(8) === 0) { bL.push(i); L[i] = 0; } else L[i] = v();
    }
    const burnt = burntMask({ Y: bY, L: bL });
    const s = makeBoard(Y, L);
    checkState(s, burnt);
    for (const h of legalHouses(s, burnt)) if (s[h] >= 14) laps++;
  }
  assert.ok(laps > 100, `exercised ${laps} lapping handfuls`);
});

test('hand-traced: W1 opening Y2 lifts 3, relays 2 at Y5, ends in the ulo', () => {
  const w1 = boards.find((b) => b.code === 'W1');
  const { s, burnt } = toState(w1.board);
  assert.deepEqual(sowEvents(s, burnt, 2).events, [
    { t: 'lift', slot: 2, n: 3 }, { t: 'drop', slot: 3 }, { t: 'drop', slot: 4 }, { t: 'drop', slot: 5 },
    { t: 'relay', slot: 5, n: 2 }, { t: 'drop', slot: 6 }, { t: 'drop', slot: ULO }, { t: 'extra', slot: ULO },
  ]);
});

test('turnEndEvents: a sweep when Lola\'s row is empty, none otherwise', () => {
  const swept = makeBoard([1, 0, 2, 0, 0, 0, 3], [0, 0, 0, 0, 0, 0, 0], { ulo: 4 });
  const a = turnEndEvents(swept, 0);
  assert.deepEqual(a.events, [{ t: 'sweep', n: 6 }]);
  assert.deepEqual([...replay(swept, a.events)], [...turnEnd(swept, 0).state]);
  assert.deepEqual(turnEndEvents(makeBoard([1, 0, 2, 0, 0, 0, 3], [0, 1, 0, 0, 0, 0, 0]), 0).events, []);
});

test('applyEvent rejects events that do not fit the state', () => {
  const s = makeBoard([2, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => applyEvent(Uint8Array.from(s), { t: 'lift', slot: 0, n: 3 }));
  assert.throws(() => applyEvent(Uint8Array.from(s), { t: 'capture', slot: 1, opp: 13, n: 2 }));
  assert.throws(() => applyEvent(Uint8Array.from(s), { t: 'bogus' }));
});

test('timing: drops speed up along long chains', () => {
  assert.equal(stepMs({ t: 'drop' }, 1), 140);
  assert.equal(stepMs({ t: 'drop' }, 13), 70);
  assert.equal(stepMs({ t: 'drop' }, 31), 35);
  assert.equal(stepMs({ t: 'lift' }, 0), 180);
  assert.equal(sowingMs([{ t: 'lift' }, { t: 'drop' }, { t: 'drop' }, { t: 'extra' }]), 180 + 140 + 140 + 650);
});

test('timing: no sowing reachable on the ten boards animates for more than 6 s at normal speed', () => {
  let worst = 0;
  for (const b of boards) {
    const { s, burnt } = toState(b.board);
    for (const x of reachable(s, burnt)) {
      for (const h of legalHouses(x, burnt)) worst = Math.max(worst, sowingMs(sowEvents(x, burnt, h).events));
    }
  }
  assert.ok(worst <= 6000, `worst sowing ${worst} ms`);
});
