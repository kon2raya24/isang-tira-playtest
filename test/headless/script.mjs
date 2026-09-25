// The full scripted playthrough shared by the headless checks, and the results text the session
// reducer expects from it. Each non-guided board plays the obvious (greedy) line first when it
// misses par, ticked "guessed", then the first perfect line, ticked "worked".
import * as S from '../../src/session.mjs';
import { playLine } from '../../src/engine.mjs';
import { toState } from '../../src/helper-data.mjs';
import { boards } from '../../src/build-boards.mjs';

const byCode = Object.fromEntries(boards.map((b) => [b.code, b]));
const houses = (moves) => moves.map((m) => Number(m.slice(1)));

export const plan = S.ORDER.map((code) => {
  if (code === 'M1') return { code, tries: 'auto' };
  const b = byCode[code];
  const { s, burnt } = toState(b.board);
  const greedy = houses(b.greedyMoves);
  const tries = [];
  if (playLine(s, burnt, greedy).score < b.par) tries.push({ moves: greedy, tick: 'g' });
  tries.push({ moves: houses(b.lines[0].moves), tick: 'w' });
  return { code, tries };
});

export const scriptFor = (entries) => entries
  .map((p) => `${p.code}:${p.tries === 'auto' ? 'auto' : p.tries.map((t) => t.moves.join('') + t.tick).join(',')}`)
  .join(';');
export const fullScript = scriptFor(plan);

// The results text the reducer produces for the full script (why = 'test run', whole sowing).
export function expectedText(group) {
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
