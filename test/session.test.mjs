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
