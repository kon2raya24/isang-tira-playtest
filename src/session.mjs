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
