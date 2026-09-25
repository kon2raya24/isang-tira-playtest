// Pure rules for the single-turn solitaire Sungka puzzle (rules R1-R8).
// State: Uint8Array(16). 0-6 = Y0..Y6, 7 = your ulo, 8-14 = L0..L6, 15 = Lola ulo.
// burnt: bitmask over slot indices (bits 0-6 and 8-14 only).

export const ULO = 7;
export const LOLA_ULO = 15;
export const opposite = (i) => 14 - i; // Y_i <-> L_(6-i)
export const isBurnt = (burnt, i) => ((burnt >>> i) & 1) === 1;

export function checkBurnt(burnt) {
  if (burnt & ~0x7f7f) throw new Error(`illegal burnt mask ${burnt}`);
}

// Next slot along YOUR sowing path, skipping Lola ulo and burnt houses.
export function nextTable(burnt) {
  checkBurnt(burnt);
  const next = new Int8Array(16).fill(-1);
  for (let i = 0; i < 15; i++) {
    if (isBurnt(burnt, i)) continue;
    let j = (i + 1) % 15;
    while (isBurnt(burnt, j)) j = (j + 1) % 15;
    next[i] = j;
  }
  return next;
}

// Distance (in drops) from your house h to your ulo, counting non-burnt slots only.
export function distanceToUlo(burnt, h) {
  let d = 1;
  for (let j = h + 1; j <= 6; j++) if (!isBurnt(burnt, j)) d++;
  return d;
}

export function loopLength(burnt) {
  let n = 15;
  for (let i = 0; i < 15; i++) if (isBurnt(burnt, i)) n--;
  return n;
}

export function housesTotal(s) {
  let t = 0;
  for (let i = 0; i < 7; i++) t += s[i];
  for (let i = 8; i < 15; i++) t += s[i];
  return t;
}

export function legalHouses(s, burnt) {
  const out = [];
  for (let h = 0; h < 7; h++) if (!isBurnt(burnt, h) && s[h] > 0) out.push(h);
  return out;
}

// One sowing, starting by lifting `house`, following relays until the handful stops.
export function sow(state, burnt, house, next = nextTable(burnt)) {
  if (house < 0 || house > 6 || isBurnt(burnt, house) || state[house] === 0) {
    throw new Error(`illegal house ${house}`);
  }
  const s = Uint8Array.from(state);
  const bound = 15 * housesTotal(s); // R8
  let hand = s[house];
  s[house] = 0;
  let pos = house, gained = 0, drops = 0, relays = 0, captured = 0;
  const handfuls = [hand];
  for (;;) {
    while (hand > 0) {
      pos = next[pos];
      s[pos]++;
      hand--;
      drops++;
      if (pos === ULO) gained++;
    }
    if (drops > bound) throw new Error(`R8 bound violated: ${drops} > ${bound}`);
    if (pos === ULO) return { state: s, outcome: 'extra', gained, drops, handfuls, relays, captured, last: pos };
    if (s[pos] > 1) { // house was non-empty before this drop: relay
      hand = s[pos];
      s[pos] = 0;
      relays++;
      handfuls.push(hand);
      continue;
    }
    if (pos < 7) { // your house, empty before this drop
      const o = opposite(pos);
      if (!isBurnt(burnt, o) && s[o] > 0) {
        captured = s[o] + 1;
        s[o] = 0;
        s[pos] = 0;
        s[ULO] += captured;
        gained += captured;
        return { state: s, outcome: 'capture', gained, drops, handfuls, relays, captured, last: pos };
      }
      return { state: s, outcome: 'dud', gained, drops, handfuls, relays, captured, last: pos };
    }
    return { state: s, outcome: 'end', gained, drops, handfuls, relays, captured, last: pos };
  }
}

// R6 sweep, applied only when the turn ends.
export function turnEnd(state, burnt) {
  const s = Uint8Array.from(state);
  for (let i = 8; i < 15; i++) if (s[i] > 0) return { state: s, swept: 0 };
  let swept = 0;
  for (let h = 0; h < 7; h++) { swept += s[h]; s[h] = 0; }
  s[ULO] += swept;
  return { state: s, swept };
}

// Play a whole decision line. Throws if the line is illegal or does not end the turn exactly.
export function playLine(board, burnt, moves) {
  const next = nextTable(burnt);
  let s = board, score = 0;
  const sowings = [];
  for (let i = 0; i < moves.length; i++) {
    const r = sow(s, burnt, moves[i], next);
    sowings.push(r);
    score += r.gained;
    s = r.state;
    if (r.outcome !== 'extra') {
      if (i !== moves.length - 1) throw new Error('line continues after turn ended');
      const t = turnEnd(s, burnt);
      return { score: score + t.swept, state: t.state, sowings, swept: t.swept };
    }
  }
  if (legalHouses(s, burnt).length > 0) throw new Error('line stops while an extra turn is mandatory');
  const t = turnEnd(s, burnt);
  return { score: score + t.swept, state: t.state, sowings, swept: t.swept };
}

// Helper for tests and debugging: build a board from row arrays.
export function makeBoard(Y, L, { ulo = 0, lolaUlo = 0 } = {}) {
  const s = new Uint8Array(16);
  for (let i = 0; i < 7; i++) { s[i] = Y[i] || 0; s[8 + i] = L[i] || 0; }
  s[ULO] = ulo;
  s[LOLA_ULO] = lolaUlo;
  return s;
}

export function burntMask({ Y = [], L = [] } = {}) {
  let m = 0;
  for (const i of Y) m |= 1 << i;
  for (const i of L) m |= 1 << (8 + i);
  return m;
}

export function boardString(s, burnt = 0) {
  const cell = (i) => (isBurnt(burnt, i) ? 'x' : String(s[i]));
  const Y = [0, 1, 2, 3, 4, 5, 6].map(cell).join(' ');
  const L = [8, 9, 10, 11, 12, 13, 14].map(cell).join(' ');
  return `Y[${Y}] L[${L}]`;
}
