// Memoized exact solver for one puzzle board. Computes every METRIC.
import { nextTable, legalHouses, sow, turnEnd, distanceToUlo } from './engine.mjs';

export const POSITION_CAP = 200000;
const LINE_ENUM_LIMIT = 64n; // enumerate perfect lines explicitly only when this few exist

export class CapExceeded extends Error {
  constructor(cap) { super(`positionsSearched > ${cap}`); this.cap = cap; }
}

// ---- exact rationals (BigInt) ----
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
export function rat(n, d = 1n) { const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; }
export const ratAdd = (x, y) => rat(x.n * y.d + y.n * x.d, x.d * y.d);
export const ratDiv = (x, k) => rat(x.n, x.d * BigInt(k));
export const ratLe = (x, y) => x.n * y.d <= y.n * x.d;
export const ratToString = (x) => `${x.n}/${x.d}`;
export const ratToNumber = (x) => Number(x.n) / Number(x.d);

const key = (s) => String.fromCharCode(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[8], s[9], s[10], s[11], s[12], s[13], s[14]);

export function solve(board, burnt, { cap = POSITION_CAP } = {}) {
  const t0 = performance.now();
  const next = nextTable(burnt);

  // Every child of a decision state: its value contribution, and the next decision state (or null if the turn ends).
  function children(s) {
    return legalHouses(s, burnt).map((h) => {
      const r = sow(s, burnt, h, next);
      if (r.outcome === 'extra') return { h, r, child: r.state, immediate: r.gained, swept: 0 };
      const t = turnEnd(r.state, burnt);
      return { h, r, child: null, immediate: r.gained + t.swept, swept: t.swept };
    });
  }

  // Phase 1: best remaining score from every reachable decision state.
  const best = new Map();
  let visited = 0;
  function value(s) {
    const k = key(s);
    const v = best.get(k);
    if (v !== undefined) return v;
    if (++visited > cap) throw new CapExceeded(cap);
    const ch = children(s);
    let b;
    if (ch.length === 0) b = turnEnd(s, burnt).swept; // extra turn with no legal house: turn ends
    else {
      b = -1;
      for (const c of ch) {
        const val = c.immediate + (c.child ? value(c.child) : 0);
        if (val > b) b = val;
      }
    }
    best.set(k, b);
    return b;
  }

  let par;
  try {
    par = value(board);
  } catch (e) {
    if (e instanceof CapExceeded) return { capExceeded: true, positionsSearched: visited, solveMs: performance.now() - t0 };
    throw e;
  }

  // Optimal children of a decision state (those that keep par reachable).
  function optimal(s) {
    const b = best.get(key(s));
    const ch = children(s);
    return { ch, opt: ch.filter((c) => c.immediate + (c.child ? best.get(key(c.child)) : 0) === b) };
  }

  // Phase 2: over the optimal sub-DAG only: line count, depth range, exact random-play probability.
  const LEAF = { count: 1n, minD: 0, maxD: 0, prob: rat(1n) };
  const memo2 = new Map();
  function stats(s) {
    const k = key(s);
    const m = memo2.get(k);
    if (m) return m;
    const { ch, opt } = optimal(s);
    let out;
    if (ch.length === 0) out = LEAF;
    else {
      let count = 0n, minD = Infinity, maxD = -Infinity, prob = rat(0n);
      for (const c of opt) {
        const cs = c.child ? stats(c.child) : LEAF;
        count += cs.count;
        minD = Math.min(minD, 1 + cs.minD);
        maxD = Math.max(maxD, 1 + cs.maxD);
        prob = ratAdd(prob, cs.prob);
      }
      out = { count, minD, maxD, prob: ratDiv(prob, ch.length) };
    }
    memo2.set(k, out);
    return out;
  }
  const root = stats(board);

  // Phase 3: enumerate perfect lines (only when few) and pick the easiest.
  let lines = null, easiest = null;
  if (root.count <= LINE_ENUM_LIMIT) {
    lines = [];
    const walk = (s, prefix) => {
      const { ch, opt } = optimal(s);
      if (ch.length === 0) { lines.push(prefix); return; }
      for (const c of opt) {
        const p = prefix.concat([{ h: c.h, r: c.r, swept: c.swept }]);
        if (c.child) walk(c.child, p); else lines.push(p);
      }
    };
    walk(board, []);
    lines = lines.map(lineMetrics);
    easiest = lines.slice().sort(compareEasiest)[0];
  }

  const greedy = greedyLine(board, burnt, next);
  const relayAware = greedyLine(board, burnt, next, { relayAware: true });
  const firstLegal = legalHouses(board, burnt).length;
  return {
    capExceeded: false,
    par,
    perfectLines: Number(root.count),
    sowingsMin: root.minD,
    sowingsMax: root.maxD,
    greedyScore: greedy.score,
    greedyGap: par - greedy.score,
    greedyMoves: greedy.moves,
    relayAwareScore: relayAware.score,
    relayAwareGap: par - relayAware.score,
    relayAwareMoves: relayAware.moves,
    randomParRate: root.prob,
    positionsSearched: visited,
    firstLegal,
    easiest,
    lines,
    solveMs: performance.now() - t0,
  };
}

function lineMetrics(seq) {
  let maxHandful = 0, relaySegments = 0, totalDrops = 0, captures = 0, score = 0, relayExtras = 0;
  for (const { r, swept } of seq) {
    for (const x of r.handfuls) if (x > maxHandful) maxHandful = x;
    relaySegments += r.relays;
    totalDrops += r.drops;
    if (r.outcome === 'capture') captures++;
    if (r.outcome === 'extra' && r.relays > 0) relayExtras++; // sowing that reaches the ulo only after relaying
    score += r.gained + swept;
  }
  return {
    moves: seq.map((x) => x.h),
    outcomes: seq.map((x) => x.r.outcome),
    sowings: seq.length, maxHandful, relaySegments, totalDrops, captures, relayExtras, score,
  };
}

// "Easiest" perfect line: fewest relay pickups, then smallest max handful, then fewest drops,
// then fewest sowings, then lexicographic move list (for determinism).
export function compareEasiest(a, b) {
  return a.relaySegments - b.relaySegments
    || a.maxHandful - b.maxHandful
    || a.totalDrops - b.totalDrops
    || a.sowings - b.sowings
    || a.moves.join(',').localeCompare(b.moves.join(','));
}

// The "obvious" line (see METRICS: greedyScore).
// relayAware: true is NOT the METRICS greedy. It is a stronger baseline reported next to greedyGap (never gated):
// identical, except that phase 1 also takes a sowing that reaches the ulo only after relays.
export function greedyLine(board, burnt, next = nextTable(burnt), { relayAware = false } = {}) {
  let s = board, score = 0;
  const moves = [];
  for (;;) {
    const legal = legalHouses(s, burnt);
    if (legal.length === 0) { score += turnEnd(s, burnt).swept; break; }
    const res = legal.map((h) => {
      const r = sow(s, burnt, h, next);
      const bank = r.gained + (r.outcome === 'extra' ? 0 : turnEnd(r.state, burnt).swept);
      return { h, r, bank, dist: distanceToUlo(burnt, h) };
    });
    const exact = res.filter((x) => x.r.outcome === 'extra' && (relayAware || x.r.relays === 0));
    const pool = exact.length ? exact : res;
    pool.sort((a, b) => (exact.length ? 0 : b.bank - a.bank) || a.dist - b.dist);
    const pick = pool[0];
    moves.push(pick.h);
    score += pick.r.gained;
    s = pick.r.state;
    if (pick.r.outcome !== 'extra') { score += turnEnd(s, burnt).swept; break; }
  }
  return { score, moves };
}
