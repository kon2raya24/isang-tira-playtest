// Independent reference for tests and verify.mjs, written from the AGREED RULES / METRICS text.
// It shares NO code with engine.mjs, solver.mjs or gen.mjs (test/reference.test.mjs enforces this), so a
// rules bug in the engine (path, relay test, capture maths, sweep) makes the brute-force cross-checks fail.
//
// Board format = the published rows: { Y: [Y0..Y6], L: [L0..L6] }, with 'x' marking a burnt house.
// Internally a position is a plain object keyed by slot name: 'Y0'..'Y6', 'U' (your ulo), 'L0'..'L6'.
// Lola's ulo is never sown into (R1), so it is not represented at all.

const YOURS = ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];
const LOLAS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
const burntIn = (rows, name) => (name[0] === 'Y' ? rows.Y : rows.L)[+name[1]] === 'x';
const oppositeOf = (name) => `L${6 - +name[1]}`; // R1: the house opposite Y_i is L_(6-i)

// R1 + R5: Y0..Y6, your ulo, L0..L6, then back to Y0; burnt houses are not on the path.
export function pathOf(rows) {
  return [...YOURS, 'U', ...LOLAS].filter((n) => n === 'U' || !burntIn(rows, n));
}

export function initialState(rows) {
  const st = { U: 0 };
  for (const n of [...YOURS, ...LOLAS]) st[n] = burntIn(rows, n) ? 0 : rows[n[0]][+n[1]];
  return st;
}

export const legalRef = (st, rows) => YOURS.filter((n) => !burntIn(rows, n) && st[n] > 0).map((n) => +n[1]);
export const distRef = (path, h) => path.indexOf('U') - path.indexOf(`Y${h}`); // R5: non-burnt slots only
const shellsInHouses = (st) => [...YOURS, ...LOLAS].reduce((a, n) => a + st[n], 0);
const keyOf = (st) => [...YOURS, ...LOLAS].map((n) => st[n]).join(',');

// R2-R4: one sowing from your house h, following relays. Returns a new state; the input is not changed.
export function sowRef(st0, rows, h, path = pathOf(rows)) {
  const st = { ...st0 };
  const origin = `Y${h}`;
  if (burntIn(rows, origin) || !(st[origin] > 0)) throw new Error(`illegal house ${h}`);
  const bound = 15 * shellsInHouses(st); // R8
  let at = path.indexOf(origin);
  let hand = st[origin];
  st[origin] = 0; // R3: no skip-origin; a lapping handful drops into it like any other house
  const handfuls = [hand];
  let banked = 0, drops = 0, relays = 0, captured = 0;
  for (;;) {
    let slot, before;
    while (hand > 0) {
      at = (at + 1) % path.length;
      slot = path[at];
      before = st[slot];
      st[slot] = before + 1;
      hand--;
      drops++;
      if (slot === 'U') banked++;
    }
    if (drops > bound) throw new Error(`R8 bound violated: ${drops} > ${bound}`);
    if (slot === 'U') return { st, outcome: 'extra', banked, drops, handfuls, relays, captured }; // R4a
    if (before > 0) { // R4b: non-empty before this drop -> lift everything there, including the shell just dropped
      hand = st[slot];
      st[slot] = 0;
      relays++;
      handfuls.push(hand);
      continue;
    }
    if (slot[0] === 'Y') { // R4c: your house, empty before this drop
      const opp = oppositeOf(slot);
      if (!burntIn(rows, opp) && st[opp] >= 1) {
        captured = st[opp] + 1; // the opposite shells PLUS the capturing shell
        st[opp] = 0;
        st[slot] = 0;
        st.U += captured;
        banked += captured;
        return { st, outcome: 'capture', banked, drops, handfuls, relays, captured };
      }
      return { st, outcome: 'dud', banked, drops, handfuls, relays, captured };
    }
    return { st, outcome: 'end', banked, drops, handfuls, relays, captured }; // R4d
  }
}

// R6: round-end sweep, applied only when the turn ends. Burnt Lola houses hold 0, so they count as empty.
export function sweepRef(st0) {
  const st = { ...st0 };
  if (LOLAS.some((n) => st[n] > 0)) return { st, swept: 0 };
  let swept = 0;
  for (const n of YOURS) { swept += st[n]; st[n] = 0; }
  st.U += swept;
  return { st, swept };
}

// Brute force: enumerate EVERY decision sequence, with no memo. Scores follow R7 (shells added to your ulo).
export function brute(rows) {
  const path = pathOf(rows);
  const lines = [];
  const seen = new Set(); // distinct decision states (turn start + every extra turn), keyed by the 14 house counts
  function rec(st, moves, score, den, recs) {
    seen.add(keyOf(st));
    const legal = legalRef(st, rows);
    if (legal.length === 0) { // R4a: extra turn with no legal house -> the turn ends
      lines.push({ moves, score: score + sweepRef(st).swept, den, recs });
      return;
    }
    for (const h of legal) {
      const r = sowRef(st, rows, h, path);
      const m2 = [...moves, h], d2 = den * BigInt(legal.length), rec2 = [...recs, r];
      if (r.outcome === 'extra') rec(r.st, m2, score + r.banked, d2, rec2);
      else lines.push({ moves: m2, score: score + r.banked + sweepRef(r.st).swept, den: d2, recs: rec2 });
    }
  }
  rec(initialState(rows), [], 0, 1n, []);
  const par = Math.max(...lines.map((l) => l.score));
  const perfect = lines.filter((l) => l.score === par);
  // exact sum of 1/den over perfect lines = probability that uniform random play reaches par
  let num = 0n, den = 1n;
  for (const l of perfect) { num = num * l.den + den; den = den * l.den; }
  const metrics = perfect.map((l) => ({
    moves: l.moves,
    relaySegments: l.recs.reduce((a, r) => a + r.relays, 0),
    maxHandful: Math.max(...l.recs.flatMap((r) => r.handfuls)),
    totalDrops: l.recs.reduce((a, r) => a + r.drops, 0),
    sowings: l.moves.length,
    captures: l.recs.filter((r) => r.outcome === 'capture').length,
    relayExtras: l.recs.filter((r) => r.outcome === 'extra' && r.relays > 0).length,
  }));
  // "easiest" perfect line: fewest relay pickups, then smallest max handful, then fewest drops,
  // then fewest sowings, then lexicographic move list
  metrics.sort((a, b) => a.relaySegments - b.relaySegments || a.maxHandful - b.maxHandful
    || a.totalDrops - b.totalDrops || a.sowings - b.sowings || a.moves.join(',').localeCompare(b.moves.join(',')));
  return {
    par, lines: lines.length, perfectLines: perfect.length,
    sowingsMin: Math.min(...perfect.map((l) => l.moves.length)),
    sowingsMax: Math.max(...perfect.map((l) => l.moves.length)),
    prob: { num, den }, positions: seen.size, easiest: metrics[0], perfect: metrics,
    firstLegal: legalRef(initialState(rows), rows).length,
  };
}

// The METRICS "obvious" line, written from its text.
// relayAware: true is the report-only stronger baseline (not the METRICS greedy): in step 1, ANY legal house whose
// full sowing ends in your ulo counts, relays included (found by simulating each sowing), nearest the ulo first.
export function greedyRef(rows, { relayAware = false } = {}) {
  const path = pathOf(rows);
  const U = path.indexOf('U');
  let st = initialState(rows), score = 0;
  const moves = [];
  for (;;) {
    const legal = legalRef(st, rows);
    if (legal.length === 0) return { score: score + sweepRef(st).swept, moves };
    let pick = null;
    // 1) a FIRST handful (before any relay) that ends exactly in your ulo? nearest the ulo wins.
    //    Worked out by counting steps along the path (laps included), not by simulating the sowing.
    for (const h of legal) {
      const ends = relayAware ? sowRef(st, rows, h, path).outcome === 'extra'
        : (path.indexOf(`Y${h}`) + st[`Y${h}`]) % path.length === U;
      if (ends && (pick === null || distRef(path, h) < distRef(path, pick))) pick = h;
    }
    // 2) otherwise the house whose full sowing banks the most (sweep included if the turn ends); ties nearest the ulo
    if (pick === null) {
      let bestBank = -1;
      for (const h of legal) {
        const r = sowRef(st, rows, h, path);
        const bank = r.banked + (r.outcome === 'extra' ? 0 : sweepRef(r.st).swept);
        if (bank > bestBank || (bank === bestBank && distRef(path, h) < distRef(path, pick))) { bestBank = bank; pick = h; }
      }
    }
    const r = sowRef(st, rows, pick, path);
    moves.push(pick);
    score += r.banked;
    st = r.st;
    if (r.outcome !== 'extra') return { score: score + sweepRef(st).swept, moves };
  }
}
