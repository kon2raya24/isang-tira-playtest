# Digital Playtest (`play.html`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `play.html`: the ten paper-playtest boards, playable and animated in a browser. It records every try and ends with copyable results and animated replays of the perfect lines.

**Architecture:**

- **Pure modules:** `events.mjs` (drop-by-drop events derived from `engine.mjs`), `timing.mjs` (animation durations), `session.mjs` (the playtest reducer and results text), `demos.mjs` (start-screen positions). Each is unit-tested in Node.
- **DOM layer:** `src/play/app.js` renders screens and plays only those events.
- **Build:** `src/build-play.mjs` inlines everything into one offline HTML file, like `build-helper.mjs`.

**Tech Stack:**

- Plain ES modules, Node 26 `node --test`.
- Vanilla DOM, Web Animations API and WebAudio.
- No dependencies and no build step beyond the inliner.
- Headless Chrome for page checks.

**Spec:** `docs/superpowers/specs/2026-09-25-digital-playtest-design.md`

## Global Constraints

- Rules come only from `src/engine.mjs`. The page never re-implements sowing.
- Invariant: applying `sowEvents(...).events` to a copy of the state gives exactly `sow(...).state`.
- Board order is `M1 M2 M3 W1 W2 W3 W4 S1 S2 S3`. Modes come from `src/modes.mjs`, and Monday is always FH.
- Up to 3 tries per board. A board ends at par or after 3 tries. A tick (`worked | partly | guessed`) is required after every non-guided try. M1 is guided and excluded from metrics.
- Nothing about any answer is shown before S3 is finished. Replays are reachable only from the results screen.
- Storage key `isangtira.playtest.v1` and mute key `isangtira.playtest.mute`. Every storage access is in try/catch, and test mode never touches storage.
- The results text format is exactly as in the spec's "Results text" section.
- `play.html` is self-contained: no external requests, and `<meta name="robots" content="noindex">`.
- At 360 px there is no horizontal scroll, and your-row tap targets are at least 34 × 34 px. The page is at most 760 px wide and the board at most 620 px.
- Reduced motion: events apply instantly, with no hops.
- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Rapid taps during a sowing**, for example double-tapping to sow and then tapping again, must record exactly one sowing. Pinned by the `mash=1` headless run in Task 4, which must produce the same results text as the plain run.
2. **A reload mid-try** must resume on the same board: recorded tries kept, the interrupted try restarted. Pinned by the `resume` unit test in Task 2.
3. **With storage unavailable** (private mode, blocked), a full playthrough still works. Pinned by the Task 4 full scripted playthrough: test mode runs with storage disabled.
4. **The longest relay chains** must keep one sowing's normal-speed animation at or under 6 s. Pinned by the `sowingMs` test over every reachable decision of the ten boards in Task 1.
5. **A 360 px phone:** no horizontal scroll, and your-row houses at least 34 px. Pinned by the Task 4 `measure=1` check in a 360 px iframe.

---

### Task 1: Event stream and animation timing

**Files:**
- Create: `src/events.mjs`, `src/timing.mjs`
- Test: `test/events.test.mjs`

**Interfaces:**
- Consumes (from `src/engine.mjs`): `ULO`, `opposite`, `nextTable`, `sow`, `turnEnd`, `legalHouses`, `makeBoard`.
- Produces:
  - `sowEvents(state, burnt, house, next?) -> { events, result }`
    - `result` is `sow()`'s return value.
    - `events` are `{t:'lift'|'relay', slot, n}`, `{t:'drop', slot}`, and one terminal event: `{t:'extra', slot:ULO}`, `{t:'capture', slot, opp, n}`, `{t:'dud', slot}` or `{t:'end', slot}`.
  - `turnEndEvents(state, burnt) -> { events: [] | [{t:'sweep', n}], result }`.
  - `applyEvent(s, e) -> s` mutates in place and throws on a mismatch.
  - `stepMs(e, dropIndex) -> ms` and `sowingMs(events) -> ms`.

- [ ] **Step 1: Write the failing tests**

```js file=test/events.test.mjs
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/events.test.mjs`
Expected: FAIL with `Cannot find module '.../src/events.mjs'`.

- [ ] **Step 3: Write the implementation**

```js file=src/events.mjs
// Drop-by-drop events for one sowing, derived from engine.mjs so the animation can never
// disagree with the rules. Applying the events in order to a copy of the state gives exactly
// the state that sow() / turnEnd() return.
import { ULO, opposite, nextTable, sow, turnEnd } from './engine.mjs';

export function sowEvents(state, burnt, house, next = nextTable(burnt)) {
  const result = sow(state, burnt, house, next);
  const events = [];
  let pos = house;
  result.handfuls.forEach((n, i) => {
    events.push({ t: i === 0 ? 'lift' : 'relay', slot: pos, n });
    for (let k = 0; k < n; k++) {
      pos = next[pos];
      events.push({ t: 'drop', slot: pos });
    }
  });
  if (pos !== result.last) throw new Error(`events walk ended at ${pos}, engine at ${result.last}`);
  if (result.outcome === 'extra') events.push({ t: 'extra', slot: ULO });
  else if (result.outcome === 'capture') events.push({ t: 'capture', slot: pos, opp: opposite(pos), n: result.captured });
  else events.push({ t: result.outcome, slot: pos });
  return { events, result };
}

export function turnEndEvents(state, burnt) {
  const result = turnEnd(state, burnt);
  return { events: result.swept ? [{ t: 'sweep', n: result.swept }] : [], result };
}

// Apply one event to s (a Uint8Array(16)) in place. Throws if the event does not fit the state.
export function applyEvent(s, e) {
  switch (e.t) {
    case 'lift':
    case 'relay':
      if (s[e.slot] !== e.n) throw new Error(`${e.t} ${e.n} from slot ${e.slot} holding ${s[e.slot]}`);
      s[e.slot] = 0;
      break;
    case 'drop':
      s[e.slot]++;
      break;
    case 'capture':
      if (s[e.slot] !== 1 || s[e.opp] + 1 !== e.n) throw new Error(`capture ${e.n} does not fit slots ${e.slot}/${e.opp}`);
      s[e.slot] = 0;
      s[e.opp] = 0;
      s[ULO] += e.n;
      break;
    case 'sweep': {
      let t = 0;
      for (let h = 0; h < 7; h++) { t += s[h]; s[h] = 0; }
      if (t !== e.n) throw new Error(`sweep ${e.n} but your houses held ${t}`);
      s[ULO] += t;
      break;
    }
    case 'extra':
    case 'dud':
    case 'end':
      break;
    default:
      throw new Error(`unknown event ${e.t}`);
  }
  return s;
}
```

```js file=src/timing.mjs
// Normal-speed duration (ms) of each animation event. Drops speed up along long chains so
// that even the longest relay stays watchable. dropIndex is the 1-based drop count so far.
export function stepMs(e, dropIndex) {
  switch (e.t) {
    case 'lift': return 180;
    case 'drop': return dropIndex <= 12 ? 140 : dropIndex <= 30 ? 70 : 35;
    case 'relay': return 220;
    case 'extra': return 650;
    case 'capture':
    case 'sweep': return 450;
    case 'dud':
    case 'end': return 300;
    default: return 0;
  }
}

export function sowingMs(events) {
  let ms = 0, drops = 0;
  for (const e of events) {
    if (e.t === 'drop') drops++;
    ms += stepMs(e, drops);
  }
  return ms;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: PASS: 28 existing tests plus 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/events.mjs src/timing.mjs test/events.test.mjs
git commit -m "feat(play): drop-by-drop sowing events and animation timing"
```

---

### Task 2: Session reducer and results text

**Files:**
- Create: `src/session.mjs`
- Test: `test/session.test.mjs`

**Interfaces:**
- Consumes: `modeFor(group, code)` from `src/modes.mjs`.
- Produces (all pure; each returns a new session):
  - Constants: `ORDER`, `TICKS`, `PREFS`, `MAX_TRIES`.
  - `groupFor(search, rand)` and `formatLocal(date)`.
  - `newSession({tester, group, device, started, now})` and `currentBoard(s)`.
  - `notePreview(s, house)`, `recordSowing(s, house, now)`, `finishTry(s, score, par)`.
  - `setTick(s, tick)`, `retry(s, now)`, `nextBoard(s, now)`.
  - `setPreference(s, preferred, why)` and `resume(s, now)`.
  - `serialize(s)`, `deserialize(text) -> s | null`, `resultsText(s, pars)`.
- Session shape: `{ v:1, tester, group, device, started, index, phase: 'play'|'tick'|'retry'|'done'|'results', boards:[{code, guided, tries:[{moves, score, reachedPar, tick, previews, secs}]}], current:{moves, previews, previewed, startedAt, lastAt}|null, preferred, why }`.

- [ ] **Step 1: Write the failing tests**

```js file=test/session.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/session.mjs';

const PARS = { M1: 6, M2: 6, M3: 6, W1: 7, W2: 7, W3: 7, W4: 7, S1: 13, S2: 14, S3: 13 };
const start = (group = 'A') => S.newSession({ tester: ' AB ', group, device: 'phone', started: '2026-09-27 19:02', now: 0 });
const sowAll = (s, moves, now = 0) => moves.reduce((acc, h) => S.recordSowing(acc, h, now), s);
const guidedM1 = (s) => S.nextBoard(S.finishTry(sowAll(s, [5, 6, 4]), 6, 6), 0);

test('groupFor honours ?group=A|B and otherwise splits on rand()', () => {
  assert.equal(S.groupFor('?group=B', () => 0), 'B');
  assert.equal(S.groupFor('?group=A&x=1', () => 0.9), 'A');
  assert.equal(S.groupFor('?group=C', () => 0.2), 'A');
  assert.equal(S.groupFor('', () => 0.7), 'B');
});

test('formatLocal gives YYYY-MM-DD HH:MM in local time', () => {
  assert.equal(S.formatLocal(new Date(2026, 8, 7, 9, 5)), '2026-09-07 09:05');
});

test('a new session starts on M1, guided, with trimmed initials', () => {
  const s = start();
  assert.equal(s.tester, 'AB');
  assert.equal(S.currentBoard(s).code, 'M1');
  assert.equal(S.currentBoard(s).guided, true);
  assert.equal(s.phase, 'play');
  assert.deepEqual(s.boards.map((b) => b.code), S.ORDER);
});

test('M1 is guided: one try, no tick, straight to done', () => {
  let s = S.finishTry(sowAll(start(), [5, 6, 4]), 6, 6);
  assert.equal(s.phase, 'done');
  assert.throws(() => S.setTick(s, 'worked'));
  s = S.nextBoard(s, 0);
  assert.equal(S.currentBoard(s).code, 'M2');
  assert.equal(s.phase, 'play');
});

test('a try that reaches par ends the board after its tick', () => {
  let s = guidedM1(start());
  s = S.finishTry(sowAll(s, [4, 6, 2]), 6, 6);
  assert.equal(s.phase, 'tick');
  s = S.setTick(s, 'worked');
  assert.equal(s.phase, 'done');
  assert.throws(() => S.retry(s, 0));
});

test('three tries below par end the board; a fourth is impossible', () => {
  let s = guidedM1(start());
  for (let k = 0; k < 3; k++) {
    s = S.setTick(S.finishTry(sowAll(s, [0]), 1, 6), 'guessed');
    if (k < 2) { assert.equal(s.phase, 'retry'); s = S.retry(s, 0); }
  }
  assert.equal(s.phase, 'done');
  assert.equal(S.currentBoard(s).tries.length, S.MAX_TRIES);
  assert.throws(() => S.retry(s, 0));
});

test('a tick is required and must be one of worked/partly/guessed', () => {
  let s = S.finishTry(sowAll(guidedM1(start()), [0]), 1, 6);
  assert.throws(() => S.retry(s, 0), 'no retry before the tick');
  assert.throws(() => S.nextBoard(s, 0), 'no next board before the tick');
  assert.throws(() => S.setTick(s, 'maybe'));
  s = S.setTick(s, 'partly');
  assert.equal(S.currentBoard(s).tries[0].tick, 'partly');
});

test('previews count each newly previewed house once and reset after a sowing', () => {
  let s = guidedM1(start());
  s = S.notePreview(s, 2); s = S.notePreview(s, 2); s = S.notePreview(s, 4); s = S.notePreview(s, 2);
  assert.equal(s.current.previews, 3);
  s = S.recordSowing(s, 2, 0);
  s = S.notePreview(s, 2);
  assert.equal(s.current.previews, 4, 'the same house after a sowing counts again');
});

test('secs run from the try start to its last sowing', () => {
  let s = S.nextBoard(S.finishTry(sowAll(start(), [5, 6, 4]), 6, 6), 10_000);
  s = S.recordSowing(s, 4, 12_000); s = S.recordSowing(s, 6, 51_400);
  s = S.finishTry(s, 6, 6);
  assert.equal(S.currentBoard(s).tries[0].secs, 41);
});

test('resume restarts an interrupted try and keeps recorded tries', () => {
  let s = guidedM1(start());
  s = S.retry(S.setTick(S.finishTry(sowAll(s, [0]), 1, 6), 'guessed'), 0);
  s = S.notePreview(s, 4); s = S.recordSowing(s, 4, 5000);
  const r = S.resume(s, 9000);
  assert.deepEqual(r.current, { moves: [], previews: 0, previewed: null, startedAt: 9000, lastAt: 9000 });
  assert.equal(S.currentBoard(r).tries.length, 1);
  assert.equal(r.phase, 'play');
  const t = S.finishTry(sowAll(guidedM1(start()), [0]), 1, 6);
  assert.equal(S.resume(t, 1), t, 'resume leaves non-play phases alone');
});

test('serialize/deserialize round-trips; junk and other versions are rejected', () => {
  const s = S.setTick(S.finishTry(sowAll(guidedM1(start()), [0]), 1, 6), 'guessed');
  assert.deepEqual(S.deserialize(S.serialize(s)), s);
  assert.equal(S.deserialize('not json'), null);
  assert.equal(S.deserialize(''), null);
  assert.equal(S.deserialize(JSON.stringify({ ...s, v: 2 })), null);
  assert.equal(S.deserialize(JSON.stringify({ ...s, group: 'C' })), null);
  assert.equal(S.deserialize(JSON.stringify({ ...s, boards: s.boards.slice(1) })), null);
  assert.equal(S.deserialize(JSON.stringify({ ...s, phase: 'weird' })), null);
});

test('setPreference validates and collapses whitespace in why', () => {
  const s = S.setPreference(start(), 'whole sowing', '  It felt\n more   like planning. ');
  assert.equal(s.preferred, 'whole sowing');
  assert.equal(s.why, 'It felt more like planning.');
  assert.equal(S.setPreference(start(), null, 'x'.repeat(400)).why.length, 280);
  assert.throws(() => S.setPreference(start(), 'both', ''));
});

test('resultsText matches the exact format', () => {
  let s = S.nextBoard(S.finishTry(sowAll(start(), [5, 6, 4]), 6, 6), 0);   // M1 guided
  s = S.notePreview(s, 5); s = S.notePreview(s, 6); s = S.notePreview(s, 1);
  s = S.recordSowing(s, 5, 10_000); s = S.recordSowing(s, 6, 20_000); s = S.recordSowing(s, 1, 41_000);
  s = S.nextBoard(S.setTick(S.finishTry(s, 6, 6), 'worked'), 41_000);      // M2: par on try 1
  s = S.setTick(S.finishTry(S.recordSowing(s, 0, 41_000), 1, 6), 'guessed');
  s = S.retry(s, 50_000);
  s = S.notePreview(s, 3); s = S.recordSowing(s, 3, 52_000); s = S.recordSowing(s, 1, 60_000);
  s = S.setTick(S.finishTry(s, 6, 6), 'partly');                           // M3: par on try 2
  s = S.setPreference(s, 'whole sowing', 'It felt\n more like   planning.');
  assert.equal(S.resultsText(s, PARS), [
    'ISANG TIRA PLAYTEST v1',
    'tester: AB | group: A | started: 2026-09-27 19:02 | device: phone',
    'M1 FH par 6 | guided',
    'M2 FH par 6 | 1: Y5 Y6 Y1 = 6 PAR worked 3pv 41s',
    'M3 FH par 6 | 1: Y0 = 1 guessed 0pv 0s | 2: Y3 Y1 = 6 PAR partly 1pv 10s',
    'W1 FH par 7 | -',
    'W2 FH par 7 | -',
    'W3 WS par 7 | -',
    'W4 WS par 7 | -',
    'S1 FH par 13 | -',
    'S2 WS par 14 | -',
    'S3 FH par 13 | -',
    'preferred: whole sowing',
    'why: It felt more like planning.',
  ].join('\n'));
  assert.match(S.resultsText(start('B'), PARS), /\nW1 WS par 7 \| -\n/);
  assert.match(S.resultsText(start(), PARS), /\nM1 FH par 6 \| -\n[\s\S]*\npreferred: -\nwhy: -$/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/session.test.mjs`
Expected: FAIL with `Cannot find module '.../src/session.mjs'`.

- [ ] **Step 3: Write the implementation**

```js file=src/session.mjs
// Pure session state for the digital playtest: tries, ticks, previews, timing and the results
// text. Every function returns a new session; nothing here touches the DOM, storage or clocks.
import { modeFor } from './modes.mjs';

export const ORDER = ['M1', 'M2', 'M3', 'W1', 'W2', 'W3', 'W4', 'S1', 'S2', 'S3'];
export const TICKS = ['worked', 'partly', 'guessed'];
export const PREFS = ['first handful', 'whole sowing', 'no difference'];
export const MAX_TRIES = 3;
const SESSION_VERSION = 1;
const PHASES = ['play', 'tick', 'retry', 'done', 'results'];

const blankTry = (now) => ({ moves: [], previews: 0, previewed: null, startedAt: now, lastAt: now });
const copyOf = (s) => JSON.parse(JSON.stringify(s));
export const currentBoard = (s) => s.boards[s.index];

export function groupFor(search, rand) {
  const g = new URLSearchParams(search).get('group');
  if (g === 'A' || g === 'B') return g;
  return rand() < 0.5 ? 'A' : 'B';
}

export function formatLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function newSession({ tester = '', group, device, started, now }) {
  return {
    v: SESSION_VERSION,
    tester: String(tester).trim().slice(0, 12),
    group,
    device,
    started,
    index: 0,
    phase: 'play',
    boards: ORDER.map((code) => ({ code, guided: code === 'M1', tries: [] })),
    current: blankTry(now),
    preferred: null,
    why: '',
  };
}

export function notePreview(s, house) {
  if (s.phase !== 'play' || s.current.previewed === house) return s;
  const n = copyOf(s);
  n.current.previews++;
  n.current.previewed = house;
  return n;
}

export function recordSowing(s, house, now) {
  if (s.phase !== 'play') throw new Error(`cannot sow in phase ${s.phase}`);
  const n = copyOf(s);
  n.current.moves.push(house);
  n.current.previewed = null;
  n.current.lastAt = now;
  return n;
}

// The turn has ended with `score` against the board's `par`.
export function finishTry(s, score, par) {
  if (s.phase !== 'play') throw new Error(`cannot finish a try in phase ${s.phase}`);
  const n = copyOf(s);
  const b = currentBoard(n);
  const c = n.current;
  b.tries.push({
    moves: c.moves,
    score,
    reachedPar: score >= par,
    tick: null,
    previews: c.previews,
    secs: Math.round((c.lastAt - c.startedAt) / 1000),
  });
  n.current = null;
  n.phase = b.guided ? 'done' : 'tick';
  return n;
}

export function setTick(s, tick) {
  if (s.phase !== 'tick' || !TICKS.includes(tick)) throw new Error(`cannot tick ${tick} in phase ${s.phase}`);
  const n = copyOf(s);
  const b = currentBoard(n);
  const t = b.tries.at(-1);
  t.tick = tick;
  n.phase = t.reachedPar || b.tries.length >= MAX_TRIES ? 'done' : 'retry';
  return n;
}

export function retry(s, now) {
  if (s.phase !== 'retry') throw new Error(`no retry in phase ${s.phase}`);
  const n = copyOf(s);
  n.current = blankTry(now);
  n.phase = 'play';
  return n;
}

export function nextBoard(s, now) {
  if (s.phase !== 'done') throw new Error(`board not finished (phase ${s.phase})`);
  const n = copyOf(s);
  n.index++;
  if (n.index >= ORDER.length) {
    n.phase = 'results';
    n.current = null;
  } else {
    n.phase = 'play';
    n.current = blankTry(now);
  }
  return n;
}

export function setPreference(s, preferred, why) {
  if (preferred !== null && !PREFS.includes(preferred)) throw new Error(`unknown preference ${preferred}`);
  const n = copyOf(s);
  n.preferred = preferred;
  n.why = String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
  return n;
}

// On reload: a try interrupted mid-turn starts again; tries already recorded are kept.
export function resume(s, now) {
  if (s.phase !== 'play') return s;
  const n = copyOf(s);
  n.current = blankTry(now);
  return n;
}

export const serialize = (s) => JSON.stringify(s);

export function deserialize(text) {
  try {
    const s = JSON.parse(text);
    const ok = s && s.v === SESSION_VERSION && (s.group === 'A' || s.group === 'B')
      && Array.isArray(s.boards) && s.boards.length === ORDER.length
      && s.boards.every((b, i) => b && b.code === ORDER[i] && Array.isArray(b.tries))
      && Number.isInteger(s.index) && s.index >= 0 && s.index <= ORDER.length
      && PHASES.includes(s.phase);
    return ok ? s : null;
  } catch {
    return null;
  }
}

// pars: { M1: 6, ... }
export function resultsText(s, pars) {
  const lines = [
    'ISANG TIRA PLAYTEST v1',
    `tester: ${s.tester || '-'} | group: ${s.group} | started: ${s.started} | device: ${s.device}`,
  ];
  for (const b of s.boards) {
    const head = `${b.code} ${modeFor(s.group, b.code)} par ${pars[b.code]}`;
    if (b.guided) {
      lines.push(`${head} | ${b.tries.length ? 'guided' : '-'}`);
      continue;
    }
    const tries = b.tries.map((t, i) =>
      `${i + 1}: ${t.moves.map((h) => `Y${h}`).join(' ')} = ${t.score}${t.reachedPar ? ' PAR' : ''} ${t.tick ?? '-'} ${t.previews}pv ${t.secs}s`);
    lines.push(`${head} | ${tries.length ? tries.join(' | ') : '-'}`);
  }
  lines.push(`preferred: ${s.preferred ?? '-'}`, `why: ${s.why || '-'}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: PASS, including the 13 new session tests.

- [ ] **Step 5: Commit**

```bash
git add src/session.mjs test/session.test.mjs
git commit -m "feat(play): pure playtest session reducer and results text"
```

---

### Task 3: The page (`play.html`)

**Files:**
- Create: `src/demos.mjs`, `src/play/style.css`, `src/play/app.js`, `src/build-play.mjs`, `test/build-play.test.mjs`
- Modify:
  - `src/build-boards.mjs:317`: guard the main-module check, so importing it from `node -e` or another script is safe.
  - `index.html`: add the third card.
  - `README.md`: add the build command.

**Interfaces:**
- Consumes everything above:
  - engine: `ULO, isBurnt, legalHouses, distanceToUlo, makeBoard`
  - preview: `firstHandful, firstHandfulText, wholeSowing, wholeSowingText, slotName`
  - `toState`
  - modes: `MODE_NAME, modeFor`
  - events: `sowEvents, turnEndEvents, applyEvent`
  - `stepMs`
  - `DEMOS`
  - all session exports
- Produces:
  - `play.html` with the DOM ids the checks rely on: `#app`, `#b` (the play or replay board), `#demo`, `#caption`, `#panel`, `#results-text`, `#test-error`, `#test-metrics`.
  - The test hook `?test=1`, with parameters:
    - `group=A|B`
    - `script=CODE:tokens;...`: a token is a digits string (Y houses) plus an optional tick letter `w|p|g`, and `auto` plays the M1 guided line. Tries are separated by `,`.
    - `freeze=k`: hold the last scripted sowing after `k` events.
    - `motion=1`: keep normal animations.
    - `mash=1`: extra taps during each sowing.
    - `measure=1`: layout metrics.

- [ ] **Step 1: Write the failing build test**

```js file=test/build-play.test.mjs
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/build-play.test.mjs`
Expected: FAIL with `Cannot find module '.../src/demos.mjs'`.

- [ ] **Step 3: Write the demo positions**

```js file=src/demos.mjs
// Start-screen demo positions: one sowing and one rule each. None is a playtest board, and none
// shows the relay-into-your-ulo line the playtest measures.
export const DEMOS = [
  { house: 5, Y: [0, 0, 0, 0, 0, 2, 0], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'extra', relays: 0,
    caption: 'Y5 has 2 shells: one into Y6, the last into your ulo. Extra turn.' },
  { house: 2, Y: [0, 0, 2, 0, 1, 0, 0], L: [2, 0, 0, 0, 0, 0, 0], outcome: 'capture', relays: 1,
    caption: 'Y2\'s last shell lands in Y4, which has a shell: pick both up and keep sowing (relay). It ends in your empty Y6, so you capture Lola\'s 2 opposite, plus that shell.' },
  { house: 6, Y: [0, 0, 0, 0, 0, 0, 3], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'end', relays: 0,
    caption: 'Y6\'s 3 shells: one into your ulo on the way, then into Lola\'s row. The last lands in her empty L1: the turn ends.' },
  { house: 4, Y: [0, 0, 0, 0, 1, 0, 0], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'dud', relays: 0,
    caption: 'Y4\'s shell lands in your empty Y5, but Lola\'s L1 opposite is empty: a dud, and the turn ends.' },
];
```

- [ ] **Step 4: Write the stylesheet**

```css file=src/play/style.css
:root {
  --ink: #231c14; --muted: #6b5e4f; --line: #3b2f22; --paper: #fffdf8; --ground: #efe9df; --wood: #f6ecda;
  --fh: #2f5d8a; --ws: #8a4b2f; --ok: #2e7d4f; --no: #a33b2b; --shell: #fbf6ea; --shell-edge: #b7a78f;
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--ground); color: var(--ink); font: 16px/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
.app { max-width: 760px; margin: 0 auto; padding: 14px 8px 40px; }
@media (min-width: 480px) { .app { padding-inline: 16px; } }
h1 { font: 700 clamp(24px, 6vw, 32px)/1.1 Georgia, "Palatino Linotype", serif; margin: 2px 0 0; }
.kicker { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid var(--line); padding-bottom: 8px; margin-bottom: 10px; }
.par { display: flex; align-items: center; gap: 6px; border: 2px solid var(--line); border-radius: 10px; padding: 2px 10px; background: var(--paper); }
.par b { font: 700 26px/1 Georgia, serif; }
.par span { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 6px 0 10px; font-size: 15px; }
.meta .spacer { flex: 1; }
.badge { color: #fff; font-weight: 700; font-size: 13px; letter-spacing: .03em; padding: 3px 9px; border-radius: 6px; }
.badge.FH { background: var(--fh); }
.badge.WS { background: var(--ws); }
button { font: inherit; color: inherit; cursor: pointer; }
.primary, .panel button, .ticks button, .chip, .ghost { border: 2px solid var(--line); background: var(--paper); border-radius: 8px; padding: 9px 16px; min-height: 44px; }
.panel .primary, .primary { background: var(--line); color: var(--paper); font-weight: 700; }
.primary:disabled { opacity: .45; cursor: default; }
.ghost { background: transparent; }
.small { min-height: 34px; padding: 4px 10px; font-size: 14px; border: 2px solid var(--line); border-radius: 8px; background: var(--paper); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid var(--fh); outline-offset: 2px; }
.panel { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
.caption { min-height: 3em; margin: 10px 2px 0; }
.hint, .fine { color: var(--muted); font-size: 14px; }
.result { font-size: 18px; margin: 0; flex-basis: 100%; }
.result b { font: 700 28px Georgia, serif; }
.result.yes { color: var(--ok); }
.result.no { color: var(--no); }
.q { margin: 0; flex-basis: 100%; }
.ticks { display: flex; flex-wrap: wrap; gap: 8px; flex-basis: 100%; }
.coach { background: var(--paper); border: 2px solid var(--fh); border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; }
.lede { margin: 0 0 10px; }
.rules { margin: 0 0 12px; padding-left: 22px; }
.rules li { margin: 4px 0; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--muted); }
.field input, .field textarea { font: inherit; color: var(--ink); background: var(--paper); border: 2px solid var(--shell-edge); border-radius: 8px; padding: 8px 10px; min-height: 44px; }
.demo { margin: 6px 0 4px; }
.demo figcaption { min-height: 4.5em; margin-top: 8px; font-size: 15px; }

/* ---------- board ---------- */
.board { position: relative; display: grid; grid-template-columns: 10px minmax(0, 1fr) clamp(36px, 11vw, 68px); gap: 4px; max-width: 620px; margin: 0 auto; padding: 18px 6px; background: var(--wood); border: 2px solid var(--line); border-radius: 30px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.lola-ulo { border: 1.5px dashed #9a8c7a; border-radius: 8px; }
.rows { display: grid; gap: clamp(14px, 4vw, 22px); }
.row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: clamp(3px, 1vw, 8px); }
.h { position: relative; aspect-ratio: 1; border-radius: 50%; border: 2px solid var(--line); background: var(--paper); display: grid; place-items: center; padding: 0; min-width: 0; }
.h .num { position: relative; z-index: 1; font: 700 clamp(14px, 4.2vw, 22px)/1 system-ui, sans-serif; text-shadow: 0 0 3px var(--paper), 0 0 3px var(--paper); }
.h .lbl { position: absolute; left: 50%; translate: -50% 0; font: 600 10px/1 system-ui, sans-serif; color: var(--muted); white-space: nowrap; }
.row.lola .lbl { top: -14px; }
.row.you .lbl { bottom: -14px; }
.shells { position: absolute; inset: 0; }
.shells i { position: absolute; width: 24%; height: 15%; translate: -50% -50%; background: var(--shell); border: 1px solid var(--shell-edge); border-radius: 50%; rotate: var(--r); }
.h.mine[aria-disabled="false"] { cursor: pointer; }
.h.mine[aria-disabled="false"]:hover { background: #fff; }
.h.mine[aria-disabled="true"] { cursor: default; }
.h.sel { box-shadow: 0 0 0 4px var(--fh); }
.h.burnt { background: repeating-linear-gradient(45deg, #e6e0d6 0 4px, #b9ad9c 4px 7px); }
.h.taken { opacity: .45; transition: opacity .2s; }
.ulo { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 2px solid var(--line); border-radius: 999px; background: var(--paper); }
.ulo-l { font: 700 9px/1.1 Georgia, serif; text-align: center; letter-spacing: .04em; text-transform: uppercase; }
.ulo .num { font: 700 clamp(15px, 4.4vw, 24px)/1 system-ui, sans-serif; }
.fx { position: absolute; inset: 0; pointer-events: none; }
.fx > * { position: absolute; left: 0; top: 0; }
.hand { translate: -50% -50%; width: 30px; height: 30px; border-radius: 50%; background: var(--shell); border: 2px solid var(--line); box-shadow: 0 4px 8px rgba(35, 28, 20, .3); display: grid; place-items: center; font: 700 14px/1 system-ui, sans-serif; z-index: 3; }
.hand.take { background: #f3e2b8; }
.ring { translate: -50% -50%; width: var(--d, 40px); height: var(--d, 40px); border: 3px dashed var(--fh); border-radius: 50%; display: grid; place-items: center; z-index: 2; }
.ring.ws { border-color: var(--ws); }
.ring b { translate: 0 -150%; background: var(--ws); color: #fff; font-size: 11px; min-width: 18px; border-radius: 9px; padding: 1px 4px; text-align: center; }
.stamp { translate: -50% -50%; background: var(--ws); color: #fff; font: 800 18px/1 Georgia, serif; padding: 6px 10px; border-radius: 8px; rotate: -8deg; white-space: nowrap; z-index: 4; }
.spark { translate: -50% -50%; width: 9px; height: 6px; border-radius: 50%; background: var(--shell); border: 1px solid var(--shell-edge); }

/* ---------- results and replay ---------- */
.scroll { overflow-x: auto; }
.res { border-collapse: collapse; width: 100%; font-size: 14px; background: var(--paper); }
.res th, .res td { border: 1px solid #cfc4b3; padding: 6px 8px; text-align: left; }
.res thead th { background: var(--wood); }
.pref { border: 2px solid #cfc4b3; border-radius: 10px; margin: 14px 0; padding: 10px 12px; display: grid; gap: 8px; background: var(--paper); }
.pref legend { font-weight: 700; padding: 0 4px; }
.pref label:not(.field) { display: flex; gap: 8px; align-items: center; min-height: 34px; }
.results-text { white-space: pre-wrap; word-break: break-word; background: var(--paper); border: 1.5px dashed var(--line); border-radius: 8px; padding: 10px; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
.chip { min-height: 36px; padding: 4px 10px; }
.chip.on { background: var(--line); color: var(--paper); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

- [ ] **Step 5: Write the page script**

```js file=src/play/app.js
// Isang Tira digital playtest: screens, board, animation and sound.
// Rules come from the inlined engine. The animation only plays sowEvents(), so the screen can
// never disagree with the rules; session state lives in the pure session.mjs reducer.

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test') === '1';
const STORE_KEY = 'isangtira.playtest.v1';
const MUTE_KEY = 'isangtira.playtest.mute';
const BOARDS = Object.fromEntries(DATA.boards.map((b) => [b.code, b]));
const PARS = Object.fromEntries(DATA.boards.map((b) => [b.code, b.par]));
const TOP = [14, 13, 12, 11, 10, 9, 8]; // Lola's row on screen: L6..L0, left to right
const BOTTOM = [0, 1, 2, 3, 4, 5, 6]; // your row: Y0..Y6
const SHELL_SPOTS = [[50, 28], [32, 42], [68, 42], [40, 62], [60, 62], [24, 24], [76, 24], [50, 78], [20, 60], [80, 60]];
const TICK_LABEL = { worked: 'Worked it out', partly: 'Partly guessed', guessed: 'Guessed' };
const OUTCOME_LESSON = {
  extra: 'Your last shell landed in your ulo, so you get an extra turn: isa pa!',
  capture: 'Your last shell landed in your own empty house, so you capture the Lola house opposite, plus that shell.',
  dud: 'Your last shell landed in your own empty house with nothing opposite: a dud, and the turn ends.',
  end: 'Your last shell landed in an empty Lola house, so the turn ends.',
};
const PULSE = [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }];
const SHAKE = [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }];
const DIM = [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }];
const HILITE = [{ boxShadow: '0 0 0 4px rgba(138, 75, 47, .55)' }, { boxShadow: '0 0 0 0 rgba(138, 75, 47, 0)' }];
const $app = document.getElementById('app');
const $live = document.getElementById('live');

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => (TEST && Q.get('motion') !== '1') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- storage: every access guarded; test mode never touches it ----------
const store = {
  get(k) { if (TEST) return null; try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { if (TEST) return; try { localStorage.setItem(k, v); } catch { /* unavailable: keep playing */ } },
  del(k) { if (TEST) return; try { localStorage.removeItem(k); } catch { /* unavailable */ } },
};
let session = deserialize(store.get(STORE_KEY) || '');
const save = () => { if (session) store.set(STORE_KEY, serialize(session)); };

function announce(text) {
  $live.textContent = '';
  setTimeout(() => { $live.textContent = text; }, 30);
}

// ---------- sound: synthesized, starts after the first user gesture ----------
const sound = (() => {
  let ctx = null;
  let muted = store.get(MUTE_KEY) === '1';
  function tone(freq, dur, type = 'triangle', gain = 0.08, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    ensure() {
      if (TEST) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch { ctx = null; }
    },
    get muted() { return muted; },
    toggle() { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); return muted; },
    drop(slot) { if (slot === ULO) tone(150, 0.09, 'square', 0.05); else tone(320 + (slot % 8) * 28, 0.05); },
    par() { [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.5, 'sine', 0.06, i * 0.08)); },
  };
})();

// ---------- board ----------
function boardHtml(id) {
  const inner = (i) => `<span class="shells" aria-hidden="true"></span><span class="num"></span><span class="lbl" aria-hidden="true">${slotName(i)}</span>`;
  const mine = (i) => `<button type="button" class="h mine" data-slot="${i}">${inner(i)}</button>`;
  const theirs = (i) => `<div class="h" role="img" data-slot="${i}">${inner(i)}</div>`;
  return `<div class="board" id="${id}">
  <div class="lola-ulo" aria-hidden="true"></div>
  <div class="rows"><div class="row lola">${TOP.map(theirs).join('')}</div><div class="row you">${BOTTOM.map(mine).join('')}</div></div>
  <div class="ulo" role="img" data-slot="${ULO}"><span class="ulo-l">your ulo</span><span class="num"></span></div>
  <div class="fx" aria-hidden="true"></div>
</div>`;
}

// ctx: { $b, s, burnt, speed, freezeAt, quiet }. legal: your houses that may be tapped now.
function paint(ctx, legal = []) {
  ctx.$b.querySelectorAll('[data-slot]').forEach(($h) => {
    const i = Number($h.dataset.slot);
    const n = ctx.s[i];
    if (i === ULO) {
      $h.querySelector('.num').textContent = `+${n}`;
      $h.setAttribute('aria-label', `Your ulo: ${n} banked this turn`);
      return;
    }
    const burnt = isBurnt(ctx.burnt, i);
    $h.classList.toggle('burnt', burnt);
    $h.querySelector('.num').textContent = burnt ? '✕' : String(n);
    $h.querySelector('.shells').innerHTML = burnt ? '' : SHELL_SPOTS.slice(0, Math.min(n, 10))
      .map(([x, y], k) => `<i style="left:${x}%;top:${y}%;--r:${(k * 47) % 180}deg"></i>`).join('');
    const d = i < 7 && !burnt ? distanceToUlo(ctx.burnt, i) : 0;
    $h.setAttribute('aria-label', `${i < 7 ? 'Your house' : "Lola's house"} ${slotName(i)}, ${burnt ? 'burnt' : `${n} shell${n === 1 ? '' : 's'}`}${d ? `, ${d} slot${d === 1 ? '' : 's'} from your ulo` : ''}`);
    if (i < 7) {
      const ok = legal.includes(i);
      $h.setAttribute('aria-disabled', String(!ok));
      $h.tabIndex = ok ? 0 : -1;
    }
  });
}

function center(ctx, slot) {
  const r = ctx.$b.getBoundingClientRect();
  const c = ctx.$b.querySelector(`[data-slot="${slot}"]`).getBoundingClientRect();
  return [c.left - r.left - ctx.$b.clientLeft + c.width / 2, c.top - r.top - ctx.$b.clientTop + c.height / 2];
}

function fxEl(ctx, cls, html, at) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  el.style.transform = `translate(${at[0]}px, ${at[1]}px)`;
  $('.fx', ctx.$b).appendChild(el);
  return el;
}

async function move(el, from, to, ms, lift = 18) {
  const mid = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - lift];
  const a = el.animate([from, mid, to].map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })), { duration: ms, easing: 'ease-in-out' });
  el.style.transform = `translate(${to[0]}px, ${to[1]}px)`;
  await a.finished;
}

function flash(ctx, slot, keyframes, ms) {
  const el = ctx.$b.querySelector(`[data-slot="${slot}"]`);
  return el ? el.animate(keyframes, { duration: ms, easing: 'ease-out' }).finished : Promise.resolve();
}

function showRings(ctx, slots, ws) {
  clearRings(ctx);
  const size = ctx.$b.querySelector('.h').getBoundingClientRect().width + 10;
  slots.forEach((slot, k) => {
    const el = fxEl(ctx, `ring${ws ? ' ws' : ''}`, ws ? `<b>${k + 1}</b>` : '', center(ctx, slot));
    el.style.setProperty('--d', `${size}px`);
  });
}
const clearRings = (ctx) => ctx.$b.querySelectorAll('.fx .ring').forEach((el) => el.remove());

// ---------- animation: plays events and mutates ctx.s through applyEvent ----------
let activeCtx = null;

async function animate(ctx, events) {
  const fast = reduced();
  let hand = null, pos = null, inHand = 0, drops = 0;
  ctx.speed = 1;
  activeCtx = ctx;
  const ms = (e) => stepMs(e, drops) / ctx.speed;
  const dropHand = () => { if (hand) { hand.remove(); hand = null; } };
  const noise = (slot) => { if (!ctx.quiet) sound.drop(slot); };
  for (let k = 0; k < events.length; k++) {
    if (!ctx.$b.isConnected) return false;
    const e = events[k];
    if (ctx.freezeAt === k) { // test hook: hold this frame for a screenshot
      paint(ctx, []);
      if (!hand && pos !== null) hand = fxEl(ctx, 'hand', `<span>${inHand}</span>`, center(ctx, pos));
      await new Promise(() => {});
    }
    if (fast) {
      applyEvent(ctx.s, e);
      if (e.t === 'lift' || e.t === 'relay') { pos = e.slot; inHand = e.n; }
      else if (e.t === 'drop') { pos = e.slot; inHand--; drops++; }
      else pos = null;
      if (!TEST && e.slot !== undefined) flash(ctx, e.slot, HILITE, 120);
      continue;
    }
    switch (e.t) {
      case 'lift':
        applyEvent(ctx.s, e);
        paint(ctx, []);
        pos = e.slot;
        inHand = e.n;
        hand = fxEl(ctx, 'hand', `<span>${inHand}</span>`, center(ctx, pos));
        await hand.animate([{ opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }], { duration: ms(e) }).finished;
        break;
      case 'drop': {
        drops++;
        await move(hand, center(ctx, pos), center(ctx, e.slot), ms(e));
        pos = e.slot;
        inHand--;
        hand.firstChild.textContent = String(inHand);
        applyEvent(ctx.s, e);
        paint(ctx, []);
        noise(e.slot);
        flash(ctx, e.slot, PULSE, 160);
        break;
      }
      case 'relay':
        await flash(ctx, e.slot, PULSE, ms(e));
        applyEvent(ctx.s, e);
        paint(ctx, []);
        inHand = e.n;
        hand.firstChild.textContent = String(inHand);
        break;
      case 'extra': {
        dropHand();
        const st = fxEl(ctx, 'stamp', 'ISA PA!', center(ctx, ULO));
        await st.animate([{ opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1.12, offset: 0.35 }, { opacity: 1, scale: 1, offset: 0.75 }, { opacity: 0, scale: 1 }], { duration: ms(e) }).finished;
        st.remove();
        break;
      }
      case 'capture':
      case 'sweep': {
        dropHand();
        const from = e.t === 'capture' ? e.opp : 3;
        const taken = e.t === 'capture' ? [e.opp, e.slot] : BOTTOM;
        taken.forEach((i) => ctx.$b.querySelector(`[data-slot="${i}"]`).classList.add('taken'));
        const chip = fxEl(ctx, 'hand take', `<span>${e.n}</span>`, center(ctx, from));
        await move(chip, center(ctx, from), center(ctx, ULO), ms(e), 30);
        chip.remove();
        ctx.$b.querySelectorAll('.taken').forEach((el) => el.classList.remove('taken'));
        applyEvent(ctx.s, e);
        paint(ctx, []);
        noise(ULO);
        flash(ctx, ULO, PULSE, 200);
        break;
      }
      case 'dud':
        dropHand();
        await flash(ctx, e.slot, SHAKE, ms(e));
        break;
      case 'end':
        dropHand();
        await flash(ctx, e.slot, DIM, ms(e));
        break;
      default:
        throw new Error(`unknown event ${e.t}`);
    }
  }
  dropHand();
  if (fast) paint(ctx, []);
  if (activeCtx === ctx) activeCtx = null;
  return true;
}

// ---------- playing a board ----------
let ui = null; // { code, b, mode, s, burnt, busy, selected, step, guide, $b, speed, freezeAt }
let demoRun = 0; // bumped to stop the start-screen demo and any replay

const isGuided = () => currentBoard(session).guided;
const muteHtml = () => `<button type="button" class="small" data-act="mute">Sound: ${sound.muted ? 'off' : 'on'}</button>`;
const caption = (text) => { const el = $('#caption'); if (el) el.textContent = text; };
const say = (text) => { caption(text); announce(text); };

function legalNow() {
  if (!ui || ui.busy || !session || session.phase !== 'play') return [];
  const legal = legalHouses(ui.s, ui.burnt);
  return isGuided() ? legal.filter((h) => h === ui.guide[ui.step]) : legal;
}

function enterBoard() {
  demoRun++;
  const code = ORDER[session.index];
  const b = BOARDS[code];
  const { s, burnt } = toState(b.board);
  ui = { code, b, mode: modeFor(session.group, code), s, burnt, busy: false, selected: null, step: 0, guide: b.lines[0], $b: null, speed: 1, freezeAt: null };
  $app.innerHTML = `
  <header class="top">
    <div><div class="kicker">Board ${session.index + 1} of ${ORDER.length} · ${esc(b.day)}</div><h1>Board ${esc(code)}</h1></div>
    <div class="par" role="img" aria-label="Par ${b.par}"><b>${b.par}</b><span>par</span></div>
  </header>
  <div class="meta"><span class="badge ${ui.mode}">Preview: ${ui.mode === 'FH' ? 'first handful only' : 'whole sowing'}</span><span id="trycount"></span><span class="spacer"></span>${muteHtml()}</div>
  <div class="coach" id="coach" hidden></div>
  ${boardHtml('b')}
  <p class="caption" id="caption"></p>
  <div class="panel" id="panel"></div>
  <p class="hint">Tap a house to preview it, then tap it again (or press Sow) to play it. Tap anywhere during a sowing to speed it up. Keys 1–7 pick Y0–Y6.</p>`;
  ui.$b = $('#b');
  refresh();
  coach();
  if (session.phase === 'play') focusLegal();
  else focusPanel();
}

function refresh() {
  const b = currentBoard(session);
  paint(ui, legalNow());
  ui.$b.querySelectorAll('.h.mine').forEach(($h) => $h.classList.toggle('sel', Number($h.dataset.slot) === ui.selected));
  $('#trycount').innerHTML = b.guided ? 'Guided board' : `Try <b>${Math.min(b.tries.length + (session.phase === 'play' ? 1 : 0), MAX_TRIES)}</b> of ${MAX_TRIES}`;
  $('#panel').innerHTML = panelHtml();
}

function panelHtml() {
  const b = currentBoard(session);
  const last = b.tries.at(-1);
  const res = last ? `<p class="result ${last.reachedPar ? 'yes' : 'no'}"><b>${last.score}</b> of par ${ui.b.par}${last.reachedPar ? ' · par!' : ''}</p>` : '';
  switch (session.phase) {
    case 'play':
      return `<button type="button" class="primary" data-act="sow"${ui.selected === null || ui.busy ? ' disabled' : ''}>${ui.selected === null ? 'Sow' : `Sow ${slotName(ui.selected)}`}</button>`;
    case 'tick':
      return `${res}<p class="q">How did you choose your moves this try?</p><div class="ticks">${TICKS.map((t) => `<button type="button" data-act="tick" data-tick="${t}">${TICK_LABEL[t]}</button>`).join('')}</div>`;
    case 'retry':
      return `${res}<button type="button" class="primary" data-act="retry">Try again (${MAX_TRIES - b.tries.length} left)</button>`;
    case 'done':
      return `${res}${b.guided ? '<p class="q">That\'s par. M2 and M3 are yours.</p>' : ''}<button type="button" class="primary" data-act="next">${session.index === ORDER.length - 1 ? 'See your results' : 'Next board'}</button>`;
    default:
      return '';
  }
}

function coach(outcome) {
  const el = $('#coach');
  if (!el) return;
  if (!isGuided()) { el.hidden = true; return; }
  const lesson = outcome ? `${OUTCOME_LESSON[outcome]} ` : 'This first board shows you how it works. ';
  el.innerHTML = session.phase === 'play'
    ? `<b>Guided board.</b> ${esc(lesson)}Tap <b>${slotName(ui.guide[ui.step])}</b> to preview it, then tap it again to sow.`
    : `<b>Guided board.</b> ${esc(lesson)}`;
  el.hidden = false;
}

function focusLegal() {
  const h = legalNow()[0];
  if (h !== undefined) ui.$b.querySelector(`[data-slot="${h}"]`).focus({ preventScroll: true });
}
const focusPanel = () => $('#panel button')?.focus({ preventScroll: true });

function select(h) {
  if (!ui || ui.busy || !session || session.phase !== 'play') return undefined;
  if (!legalNow().includes(h)) {
    if (isGuided() && ui.s[h] > 0 && !isBurnt(ui.burnt, h)) say(`Follow the guide: tap ${slotName(ui.guide[ui.step])}.`);
    else say(isBurnt(ui.burnt, h) ? `${slotName(h)} is burnt.` : `${slotName(h)} is empty.`);
    return undefined;
  }
  if (ui.selected === h) return playMove(h);
  ui.selected = h;
  if (!isGuided()) { session = notePreview(session, h); save(); }
  const n = ui.s[h];
  if (ui.mode === 'WS') {
    const w = wholeSowing(ui.s, ui.burnt, h);
    showRings(ui, w.stops, true);
    say(`${slotName(h)} (${n}): ${wholeSowingText(w)}`);
  } else {
    const f = firstHandful(ui.s, ui.burnt, h);
    showRings(ui, [f.lands], false);
    say(`${slotName(h)} (${n}): ${firstHandfulText(f)}`);
  }
  refresh();
  return undefined;
}

async function playMove(h) {
  ui.busy = true;
  clearRings(ui);
  ui.selected = null;
  session = recordSowing(session, h, Date.now());
  save();
  const told = wholeSowingText(wholeSowing(ui.s, ui.burnt, h));
  const { events, result } = sowEvents(ui.s, ui.burnt, h);
  refresh();
  caption('');
  if (!(await animate(ui, events))) return;
  if (TEST && ui.s.join() !== result.state.join()) throw new Error(`animation diverged from the engine on ${slotName(h)}`);
  ui.s = Uint8Array.from(result.state);
  const what = `You sowed ${slotName(h)}. ${told}`;
  if (result.outcome === 'extra' && legalHouses(ui.s, ui.burnt).length) {
    ui.busy = false;
    if (isGuided()) ui.step++;
    refresh();
    say(`${what} Isa pa! Choose again.`);
    coach(result.outcome);
    focusLegal();
    return;
  }
  const te = turnEndEvents(ui.s, ui.burnt);
  await animate(ui, te.events);
  ui.s = Uint8Array.from(te.result.state);
  const score = ui.s[ULO];
  session = finishTry(session, score, ui.b.par);
  save();
  ui.busy = false;
  if (score >= ui.b.par) { sound.par(); celebrate(); }
  refresh();
  say(`${what} Turn over: ${score} of par ${ui.b.par}${score >= ui.b.par ? '. Par!' : '.'}`);
  coach(result.outcome);
  focusPanel();
}

function celebrate() {
  if (reduced() || !ui) return;
  const at = center(ui, ULO);
  for (let k = 0; k < 12; k++) {
    const el = fxEl(ui, 'spark', '', at);
    const a = (k / 12) * Math.PI * 2;
    el.animate([
      { transform: `translate(${at[0]}px, ${at[1]}px)`, opacity: 1 },
      { transform: `translate(${at[0] + Math.cos(a) * 60}px, ${at[1] + Math.sin(a) * 60}px)`, opacity: 0 },
    ], { duration: 700, easing: 'ease-out' }).finished.then(() => el.remove());
  }
}

function onTick(t) { session = setTick(session, t); save(); refresh(); focusPanel(); }
function onRetry() { session = retry(session, Date.now()); save(); enterBoard(); }
function onNext() {
  session = nextBoard(session, Date.now());
  save();
  if (session.phase === 'results') resultsScreen(); else enterBoard();
}

// ---------- start screen ----------
function startScreen() {
  demoRun++;
  ui = null;
  const resumeHtml = session
    ? `<div class="panel">${session.phase === 'results'
      ? '<button type="button" class="primary" data-act="results">See your results</button>'
      : `<button type="button" class="primary" data-act="continue">Continue: board ${Math.min(session.index + 1, ORDER.length)} of ${ORDER.length}</button>`}<button type="button" class="ghost" data-act="restart">Start over</button></div>`
    : `<div class="panel"><label class="field">Your initials (optional)<input id="initials" maxlength="12" autocomplete="off" spellcheck="false"></label><button type="button" class="primary" data-act="start">Start</button></div>`;
  $app.innerHTML = `
  <header class="top"><div><div class="kicker">Playtest · in your browser</div><h1>Isang Tira</h1></div></header>
  <p class="lede">Ten Sungka puzzles, one turn each. Bank as many shells in your ulo as you can; <b>par</b> is the best possible. You get three tries per board. This is an early test of a game that isn't built yet: it checks whether the puzzle feels like working it out or like guessing.</p>
  <ol class="rules">
    <li>Pick a house in <b>your row</b> (bottom). Its shells are sown one per slot: along your row, into <b>your ulo</b>, then along Lola's row. Lola's ulo is skipped.</li>
    <li>Last shell in <b>your ulo</b>: extra turn. Choose again.</li>
    <li>Last shell in a house that <b>has shells</b>: pick them all up and keep sowing (a relay).</li>
    <li>Last shell in <b>your own empty house</b>: capture Lola's house opposite, plus that shell. Nothing opposite? A dud.</li>
    <li>Last shell in an <b>empty Lola house</b>: the turn ends.</li>
  </ol>
  <figure class="demo"><div aria-hidden="true">${boardHtml('demo')}</div><figcaption id="demo-cap"></figcaption></figure>
  ${resumeHtml}
  <p class="fine">Your progress is saved on this device. At the end you'll copy your results and send them to whoever shared this link.</p>`;
  runDemo();
}

async function runDemo() {
  const run = ++demoRun;
  const $b = $('#demo');
  const stale = () => run !== demoRun || !$b.isConnected;
  for (let k = 0; !stale(); k = (k + 1) % DEMOS.length) {
    const d = DEMOS[k];
    const ctx = { $b, s: makeBoard(d.Y, d.L), burnt: 0, speed: 1, freezeAt: null, quiet: true };
    paint(ctx, []);
    $('#demo-cap').textContent = d.caption;
    if (TEST) return; // a static first frame in test mode
    const $h = $b.querySelector(`[data-slot="${d.house}"]`);
    $h.classList.add('sel');
    await wait(1400);
    if (stale()) return;
    $h.classList.remove('sel');
    await animate(ctx, sowEvents(ctx.s, 0, d.house).events);
    await wait(2200);
  }
}

function startSession() {
  sound.ensure();
  session = newSession({
    tester: $('#initials')?.value ?? '',
    group: groupFor(location.search, Math.random),
    device: matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop',
    started: TEST ? 'TEST' : formatLocal(new Date()),
    now: Date.now(),
  });
  save();
  enterBoard();
}

function confirmRestart(btn) {
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to erase your progress';
    return;
  }
  store.del(STORE_KEY);
  session = null;
  startScreen();
}

// ---------- results and replay ----------
function resultsScreen() {
  demoRun++;
  ui = null;
  const rows = session.boards.map((b) => {
    const cells = b.guided
      ? '<td colspan="3">guided</td>'
      : `<td>${b.tries.map((t) => `${t.score}${t.reachedPar ? ' ✓' : ''}`).join(' · ') || '—'}</td><td>${b.tries.some((t) => t.reachedPar) ? 'yes' : 'no'}</td><td>${b.tries.map((t) => TICK_LABEL[t.tick] ?? '—').join(', ') || '—'}</td>`;
    return `<tr><th scope="row">${b.code}</th><td>${MODE_NAME[modeFor(session.group, b.code)]}</td><td>${PARS[b.code]}</td>${cells}</tr>`;
  }).join('');
  $app.innerHTML = `
  <header class="top"><div><div class="kicker">All ten boards done</div><h1>Your results</h1></div></header>
  <div class="scroll"><table class="res"><thead><tr><th scope="col">Board</th><th scope="col">Preview</th><th scope="col">Par</th><th scope="col">Scores</th><th scope="col">Par?</th><th scope="col">How you chose</th></tr></thead><tbody>${rows}</tbody></table></div>
  <fieldset class="pref"><legend>Which preview felt more fun?</legend>
    ${PREFS.map((p) => `<label><input type="radio" name="pref" value="${p}"${session.preferred === p ? ' checked' : ''}> ${p[0].toUpperCase()}${p.slice(1)}</label>`).join('')}
    <label class="field">Why? (optional)<textarea id="why" maxlength="280" rows="3">${esc(session.why)}</textarea></label>
  </fieldset>
  <div class="panel"><button type="button" class="primary" data-act="copy">Copy my results</button>${navigator.share ? '<button type="button" data-act="share">Share…</button>' : ''}<span id="copied" role="status"></span></div>
  <pre id="results-text" class="results-text">${esc(resultsText(session, PARS))}</pre>
  <div class="panel"><button type="button" data-act="replay" data-code="M1">Watch the perfect lines</button><button type="button" class="ghost" data-act="restart">Start over</button></div>`;
}

function updatePreference() {
  session = setPreference(session, $('input[name="pref"]:checked')?.value ?? null, $('#why')?.value ?? '');
  save();
  $('#results-text').textContent = resultsText(session, PARS);
}

async function copyResults() {
  const text = resultsText(session, PARS);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  $('#copied').textContent = ok ? 'Copied. Paste it into a message to whoever sent you this link.' : 'Copy failed: select the text below and copy it.';
}

async function shareResults() {
  try { await navigator.share({ title: 'Isang Tira playtest results', text: resultsText(session, PARS) }); } catch { /* cancelled */ }
}

function replayScreen(code) {
  if (!session || session.phase !== 'results') return; // replays only after all ten boards
  demoRun++;
  const b = BOARDS[code];
  $app.innerHTML = `
  <header class="top"><div><div class="kicker">Perfect lines</div><h1>Board ${code}</h1></div><div class="par" role="img" aria-label="Par ${b.par}"><b>${b.par}</b><span>par</span></div></header>
  <div class="chips">${ORDER.map((c) => `<button type="button" class="chip${c === code ? ' on' : ''}" data-act="replay" data-code="${c}" aria-pressed="${c === code}">${c}</button>`).join('')}</div>
  <p>Perfect line: <b>${b.lines[0].map((h) => slotName(h)).join(' → ')}</b>${b.perfectLines > 1 ? ` (1 of ${b.perfectLines} perfect lines)` : ''}</p>
  ${boardHtml('b')}
  <p class="caption" id="caption"></p>
  <div class="panel"><button type="button" class="primary" data-act="replay-play" data-code="${code}">Play it</button><button type="button" class="ghost" data-act="results">Back to results</button></div>`;
  const { s, burnt } = toState(b.board);
  paint({ $b: $('#b'), s, burnt }, []);
}

async function playReplay(code) {
  const run = ++demoRun;
  const b = BOARDS[code];
  const { s, burnt } = toState(b.board);
  const ctx = { $b: $('#b'), s, burnt, speed: 1, freezeAt: null, quiet: false };
  paint(ctx, []);
  for (const h of b.lines[0]) {
    if (run !== demoRun || !ctx.$b.isConnected) return;
    const $h = ctx.$b.querySelector(`[data-slot="${h}"]`);
    $h.classList.add('sel');
    caption(`${slotName(h)}…`);
    await wait(reduced() ? 0 : 500);
    $h.classList.remove('sel');
    if (!(await animate(ctx, sowEvents(ctx.s, burnt, h).events))) return;
  }
  await animate(ctx, turnEndEvents(ctx.s, burnt).events);
  caption(`Banked ${ctx.s[ULO]}: par.`);
}

// ---------- input ----------
$app.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.matches('#b .h.mine')) { select(Number(t.dataset.slot)); return; }
  switch (t.dataset.act) {
    case 'start': startSession(); break;
    case 'continue':
      sound.ensure();
      session = resume(session, Date.now());
      save();
      if (session.phase === 'results') resultsScreen(); else enterBoard();
      break;
    case 'restart': confirmRestart(t); break;
    case 'sow': if (ui && ui.selected !== null) select(ui.selected); break;
    case 'tick': onTick(t.dataset.tick); break;
    case 'retry': onRetry(); break;
    case 'next': onNext(); break;
    case 'mute': sound.toggle(); t.textContent = `Sound: ${sound.muted ? 'off' : 'on'}`; break;
    case 'copy': copyResults(); break;
    case 'share': shareResults(); break;
    case 'replay': replayScreen(t.dataset.code || 'M1'); break;
    case 'replay-play': playReplay(t.dataset.code); break;
    case 'results': resultsScreen(); break;
    default: break;
  }
});

$app.addEventListener('input', (ev) => { if (ev.target.closest('.pref')) updatePreference(); });
document.addEventListener('pointerdown', () => { if (activeCtx) activeCtx.speed = 4; });

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest?.('input, textarea')) return;
  if (activeCtx && (ev.key === ' ' || ev.key === 'Enter')) activeCtx.speed = 4;
  if (!ui || !ui.$b || !ui.$b.isConnected) return;
  if (/^[1-7]$/.test(ev.key)) {
    ev.preventDefault();
    const h = Number(ev.key) - 1;
    ui.$b.querySelector(`[data-slot="${h}"]`).focus({ preventScroll: true });
    select(h);
    return;
  }
  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
    const cur = ev.target.closest?.('.h.mine');
    const legal = legalNow();
    if (!cur || !legal.length) return;
    ev.preventDefault();
    const i = legal.indexOf(Number(cur.dataset.slot));
    const j = i < 0 ? 0 : (i + (ev.key === 'ArrowRight' ? 1 : legal.length - 1)) % legal.length;
    ui.$b.querySelector(`[data-slot="${legal[j]}"]`).focus({ preventScroll: true });
  }
});

// ---------- test hook (inert unless ?test=1) ----------
async function runScript() {
  const TICKFOR = { w: 'worked', p: 'partly', g: 'guessed' };
  const PREFFOR = { fh: 'first handful', ws: 'whole sowing', nd: 'no difference' };
  const freeze = Q.has('freeze') ? Number(Q.get('freeze')) : null;
  const mash = Q.get('mash') === '1';
  const entries = (Q.get('script') || '').split(';').filter(Boolean);
  startSession();
  for (let bi = 0; bi < entries.length; bi++) {
    const [code, spec] = entries[bi].split(':');
    if (code !== ORDER[session.index]) throw new Error(`script expects ${ORDER[session.index]}, got ${code}`);
    const tokens = spec === 'auto' ? [BOARDS[code].lines[0].join('')] : spec.split(',');
    for (let ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti];
      const moves = [...tok.replace(/[wpg]$/, '')].map(Number);
      for (let mi = 0; mi < moves.length; mi++) {
        const lastOfAll = bi === entries.length - 1 && ti === tokens.length - 1 && mi === moves.length - 1;
        if (lastOfAll && freeze !== null) ui.freezeAt = freeze;
        select(moves[mi]);
        const done = select(moves[mi]);
        if (mash) { select(moves[mi]); select(moves[mi]); }
        await done;
      }
      if (session.phase === 'play') throw new Error(`${code} try ${ti + 1}: the turn did not end after ${tok}`);
      const tick = tok.match(/[wpg]$/);
      if (session.phase === 'tick') {
        if (!tick) return; // stop on the try result (for screenshots)
        onTick(TICKFOR[tick[0]]);
      }
      if (ti < tokens.length - 1) onRetry();
    }
    if (session.phase === 'done') onNext();
    else if (bi < entries.length - 1) throw new Error(`${code}: the script did not finish the board`);
  }
  if (session.phase === 'results' && Q.has('prefer')) {
    session = setPreference(session, PREFFOR[Q.get('prefer')] ?? null, Q.get('why') ?? '');
    resultsScreen();
  }
}

function measure() {
  const houses = [...document.querySelectorAll('.board .h.mine')].map((el) => el.getBoundingClientRect().width);
  const metrics = {
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    minHouse: houses.length ? Math.round(Math.min(...houses) * 10) / 10 : null,
    screen: document.querySelector('h1')?.textContent ?? '',
  };
  document.body.insertAdjacentHTML('beforeend', `<pre id="test-metrics">${esc(JSON.stringify(metrics))}</pre>`);
  if (window.parent !== window) window.parent.postMessage({ metrics }, '*');
}

const testFailed = (err) => document.body.insertAdjacentHTML('beforeend', `<pre id="test-error">${esc(err && err.stack ? err.stack : String(err))}</pre>`);
if (TEST) {
  window.addEventListener('error', (ev) => testFailed(ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => testFailed(ev.reason));
}
if (TEST && Q.has('script')) {
  runScript().catch(testFailed).finally(() => { if (Q.get('measure') === '1') measure(); });
} else {
  startScreen();
  if (TEST && Q.get('measure') === '1') measure();
}
```

- [ ] **Step 6: Write the builder, and fix the `build-boards.mjs` main-module check**

```js file=src/build-play.mjs
// node src/build-play.mjs -> play.html
// A self-contained playtest page (works offline from file://). It inlines the rules engine and the
// pure modules verbatim (import lines dropped, `export ` stripped), like build-helper.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { boards } from './build-boards.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const inline = (rel) => read(rel).split('\n').filter((l) => !/^import\s/.test(l)).join('\n').replace(/^export /gm, '');
const LIB = ['./engine.mjs', './preview.mjs', './helper-data.mjs', './modes.mjs', './events.mjs', './timing.mjs', './demos.mjs', './session.mjs']
  .map(inline).join('\n');
const dayName = { M: 'Monday', W: 'Wednesday', S: 'Saturday' };
const DATA = {
  boards: boards.map((b) => ({
    code: b.code,
    day: dayName[b.code[0]],
    par: b.par,
    perfectLines: b.perfectLines,
    board: b.board,
    lines: b.lines.map((l) => l.moves.map((m) => Number(m.slice(1)))),
  })),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isang Tira playtest: play in your browser</title>
<style>
${read('./play/style.css')}
</style>
</head>
<body>
<main id="app" class="app"></main>
<div id="live" class="sr-only" aria-live="polite"></div>
<noscript><p style="padding:16px">This playtest needs JavaScript. The printable version is at <a href="boards.html">boards.html</a>.</p></noscript>
<script>
(() => {
'use strict';
const DATA = ${JSON.stringify(DATA)};
${LIB}
${read('./play/app.js')}
})();
</script>
</body>
</html>
`;
writeFileSync(new URL('../play.html', import.meta.url), html);
console.log(`wrote play.html (${(html.length / 1024).toFixed(1)} KB, ${DATA.boards.length} boards)`);
```

In `src/build-boards.mjs`, replace the main-module line:

```js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
```

with:

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
```

- [ ] **Step 7: Add the index card and the README line**

In `index.html`, insert this as the first card inside `<div class="cards">`:

```html
    <a class="card" href="play.html"><h2>Play in your browser</h2><p>All ten boards on your phone or laptop, animated. At the end you copy your results and send them back.</p></a>
```

In `README.md`, add after the `build-helper.mjs` line:

```sh
node src/build-play.mjs              # play.html (the digital playtest)
```

and add `play.html` to the file list: ``- `play.html`: the ten boards, playable and animated in a browser; results are copied as text at the end.``

- [ ] **Step 8: Build and run every test**

Run: `node src/build-play.mjs && node --test test/*.test.mjs`
Expected: `wrote play.html (...)`. All tests pass, including the 3 in `build-play.test.mjs`.

- [ ] **Step 9: Commit**

```bash
git add src/demos.mjs src/play src/build-play.mjs src/build-boards.mjs test/build-play.test.mjs play.html index.html README.md
git commit -m "feat(play): animated, interactive browser playtest (play.html)"
```

---

### Task 4: Headless verification, independent review, fixes

**Files:**
- Create: `test/headless/play-check.mjs`. It isn't matched by `test/*.test.mjs`, because it needs Chrome.

**Interfaces:**
- Consumes the `?test=1` hook from Task 3 and `S.*` from `src/session.mjs`.
- Produces a pass/fail report and screenshots in `$SCRATCH` (the session scratchpad).

- [ ] **Step 1: Write the headless checker**

```js file=test/headless/play-check.mjs
// node test/headless/play-check.mjs [baseUrl] [outDir]
// Drives play.html through its ?test=1 hook in headless Chrome and checks the results against
// the session reducer. baseUrl defaults to the local file; outDir receives screenshots.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as S from '../../src/session.mjs';
import { playLine } from '../../src/engine.mjs';
import { toState } from '../../src/helper-data.mjs';
import { boards } from '../../src/build-boards.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const base = process.argv[2] || pathToFileURL(fileURLToPath(new URL('../../play.html', import.meta.url))).href;
const out = process.argv[3] || '.';
mkdirSync(out, { recursive: true });
const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=20000'];
const dump = (url) => execFileSync(CHROME, [...flags, '--dump-dom', url], { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'ignore'] });
const shot = (url, file, size) => execFileSync(CHROME, [...flags, `--window-size=${size}`, `--screenshot=${out}/${file}`, url], { timeout: 90_000, stdio: 'ignore' });
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const grab = (html, id) => { const m = html.match(new RegExp(`<pre[^>]*id="${id}"[^>]*>([\\s\\S]*?)</pre>`)); return m ? unesc(m[1]) : null; };
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

// A full script: each non-guided board plays the obvious (greedy) line first when it misses par,
// ticked "guessed", then the first perfect line, ticked "worked".
const byCode = Object.fromEntries(boards.map((b) => [b.code, b]));
const houses = (moves) => moves.map((m) => Number(m.slice(1)));
const plan = S.ORDER.map((code) => {
  if (code === 'M1') return { code, tries: 'auto' };
  const b = byCode[code];
  const { s, burnt } = toState(b.board);
  const greedy = houses(b.greedyMoves);
  const perfect = houses(b.lines[0].moves);
  const tries = [];
  if (playLine(s, burnt, greedy).score < b.par) tries.push({ moves: greedy, tick: 'g' });
  tries.push({ moves: perfect, tick: 'w' });
  return { code, tries };
});
const script = plan.map((p) => `${p.code}:${p.tries === 'auto' ? 'auto' : p.tries.map((t) => t.moves.join('') + t.tick).join(',')}`).join(';');

// The expected results text, built with the same reducer the page uses (seconds masked).
function expectedText(group) {
  let s = S.newSession({ tester: '', group, device: 'desktop', started: 'TEST', now: 0 });
  const TICK = { g: 'guessed', w: 'worked' };
  for (const p of plan) {
    const b = byCode[p.code];
    const { s: st, burnt } = toState(b.board);
    const tries = p.tries === 'auto' ? [{ moves: houses(b.lines[0].moves) }] : p.tries;
    tries.forEach((t, i) => {
      for (const h of t.moves) { if (p.tries !== 'auto') s = S.notePreview(s, h); s = S.recordSowing(s, h, 0); }
      s = S.finishTry(s, playLine(st, burnt, t.moves).score, b.par);
      if (t.tick) s = S.setTick(s, TICK[t.tick]);
      if (i < tries.length - 1) s = S.retry(s, 0);
    });
    s = S.nextBoard(s, 0);
  }
  s = S.setPreference(s, 'whole sowing', 'test run');
  return S.resultsText(s, Object.fromEntries(boards.map((b) => [b.code, b.par])));
}
const maskSecs = (t) => t.replace(/ \d+s\b/g, ' Ns');

for (const group of ['A', 'B']) {
  for (const mash of ['0', '1']) {
    const url = `${base}?test=1&group=${group}&mash=${mash}&prefer=ws&why=test%20run&script=${encodeURIComponent(script)}`;
    const html = dump(url);
    const err = grab(html, 'test-error');
    check(!err, `group ${group} mash=${mash}: playthrough runs without errors${err ? `\n${err}` : ''}`);
    const got = grab(html, 'results-text');
    check(got !== null && maskSecs(got) === maskSecs(expectedText(group)), `group ${group} mash=${mash}: results text matches the reducer`);
  }
}

// No spoilers before the end: mid-session DOMs never contain a later board's perfect line.
{
  const partial = plan.slice(0, 4).map((p) => `${p.code}:${p.tries === 'auto' ? 'auto' : p.tries.map((t) => t.moves.join('') + t.tick).join(',')}`).join(';');
  const html = dump(`${base}?test=1&group=A&script=${encodeURIComponent(partial)}`);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  check(!/Perfect line/i.test(visible) && !/data-act="replay"/.test(visible), 'no replay or perfect line is reachable mid-session');
}

// Layout at 360 px: measured inside a 360 px iframe (headless windows cannot go that narrow).
{
  const frame = `${out}/frame-360.html`;
  const src = (q) => `${base}?test=1&measure=1${q}`;
  writeFileSync(frame, `<!doctype html><body style="margin:0"><iframe src="${src('')}" style="width:360px;height:800px;border:0"></iframe>`
    + `<iframe src="${src(`&script=${encodeURIComponent('M1:auto')}`)}" style="width:360px;height:800px;border:0"></iframe>`
    + '<script>addEventListener("message", (e) => { const p = document.createElement("pre"); p.className = "m"; p.textContent = JSON.stringify(e.data.metrics); document.body.appendChild(p); });</script>');
  const html = dump(pathToFileURL(frame).href);
  const ms = [...html.matchAll(/<pre class="m">([^<]*)<\/pre>/g)].map((m) => JSON.parse(unesc(m[1])));
  check(ms.length === 2, `360 px: both screens measured (${ms.length})`);
  for (const m of ms) {
    check(m.scrollWidth <= m.clientWidth, `360 px ${m.screen}: no horizontal scroll (${m.scrollWidth} <= ${m.clientWidth})`);
    check(m.minHouse === null || m.minHouse >= 34, `360 px ${m.screen}: your-row houses >= 34 px (${m.minHouse})`);
  }
}

// Screenshots for a human look (desktop 1280x800; phone via a 360 px frame).
shot(`${base}?test=1`, 'play-start-desktop.png', '1280,900');
shot(`${base}?test=1&group=B&motion=1&freeze=3&script=${encodeURIComponent('M1:auto;M2:4')}`, 'play-midsow-desktop.png', '1280,900');
shot(`${base}?test=1&group=A&script=${encodeURIComponent(`M1:auto;M2:${plan[1].tries[0].moves.join('')}`)}`, 'play-tryresult-desktop.png', '1280,900');
shot(`${base}?test=1&group=A&prefer=ws&why=test&script=${encodeURIComponent(script)}`, 'play-results-desktop.png', '1280,1400');
const phoneFrame = `${out}/phone-360.html`;
writeFileSync(phoneFrame, `<!doctype html><body style="margin:0;background:#888;display:flex;gap:12px;padding:12px">${[
  '',
  `&group=B&freeze=3&script=${encodeURIComponent('M1:auto;M2:4')}`,
  `&group=A&prefer=ws&why=test&script=${encodeURIComponent(script)}`,
].map((q) => `<iframe src="${base}?test=1${q}" style="width:360px;height:900px;border:0;background:#fff"></iframe>`).join('')}`);
shot(pathToFileURL(phoneFrame).href, 'play-phone-360.png', '1140,930');
console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}; screenshots in ${out}`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it against the local build**

Run: `node test/headless/play-check.mjs "" "$SCRATCH/play-check"`, where `$SCRATCH` is the session scratchpad directory.
Expected: every line `PASS`, then `all checks passed`, and 5 PNGs in `$SCRATCH/play-check`. Open each PNG and look at it:
- the start screen with the demo board
- the mid-sowing frame, with the hand chip and dashed rings gone
- the try result with the three tick buttons
- the results screen
- the 360 px phone strip

If a check fails, fix `src/play/*`, rebuild, and re-run until all pass.

Note: passing `""` makes the script fall back to the local file, because `process.argv[2] || default`.

- [ ] **Step 3: Independent review (three reviewers in parallel)**

Each reviewer gets the spec, this plan, and read access to the repo and screenshots. The lenses:

1. **Rules fidelity.** Does anything on screen contradict `engine.mjs`? Check the preview texts and rings per mode, the guided flow, and that replays use `sowEvents`.
2. **Usability and accessibility.** Keyboard-only play, screen-reader labels and announcements, focus order, contrast, touch targets, reduced motion, and first-time comprehension from the start screen.
3. **Playtest validity.** No spoilers before S3. Counterbalancing matches `modes.mjs`. Every try is recorded with its tick, previews and seconds, and M1 is excluded. The results text follows the exact format. Resume behaves as the spec says.

Each reviewer returns concrete findings with file and line and a severity. Fix every real finding, add a regression test when the fix touches `src/*.mjs`, then re-run Steps 2 and 3 until the reviewers find nothing blocking.

- [ ] **Step 4: Commit**

```bash
git add test/headless/play-check.mjs src play.html
git commit -m "test(play): headless playthrough, spoiler and 360px layout checks; review fixes"
```

---

### Task 5: Deploy and verify live

**Files:** none new.

- [ ] **Step 1: Deploy to Vercel**

Run: `npx --yes vercel@latest deploy --prod --yes`
Expected: `readyState: READY`. The production alias is `https://isang-tira-playtest.vercel.app`.

- [ ] **Step 2: Push to GitHub Pages and wait for the build**

Run: `git push`, then poll `gh api repos/kon2raya24/isang-tira-playtest/pages/builds/latest --jq .status` until it returns `built`.

- [ ] **Step 3: Verify both live sites**

For each base (`https://isang-tira-playtest.vercel.app` and `https://kon2raya24.github.io/isang-tira-playtest`):

- Fetch `/`, `/play.html`, `/boards.html` and `/helper.html` with `curl -sS -m 40`. Each must return 200 and be byte-identical to the local file.
- Check that `/play.html` has no answer-key strings. `grep -c "Perfect line"` must count only the replay screen's template text, which sits inside the script and is reachable only after S3.
- Run `node test/headless/play-check.mjs <base>/play.html "$SCRATCH/live-check"`. All checks must pass.

- [ ] **Step 4: Update the project memory with the new page.**
