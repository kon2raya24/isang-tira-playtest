// Facilitator previews for the paper playtest. All rules come from engine.mjs;
// this module only walks the path to name where handfuls land.
import { ULO, opposite, isBurnt, nextTable, sow } from './engine.mjs';

export const slotName = (i) => (i === ULO ? 'your ulo' : i < 7 ? `Y${i}` : `L${i - 8}`);

// FIRST-HANDFUL preview: where the first handful's last shell lands and what that means.
export function firstHandful(state, burnt, house, next = nextTable(burnt)) {
  const s = Uint8Array.from(state);
  let hand = s[house];
  const size = hand;
  s[house] = 0;
  let pos = house, passUlo = 0, had = 0;
  while (hand > 0) {
    pos = next[pos];
    if (hand === 1) had = s[pos];
    s[pos]++;
    hand--;
    if (pos === ULO) passUlo++;
  }
  const r = { house, size, lands: pos, had, passUlo };
  if (pos === ULO) return { ...r, meaning: 'extra' };
  if (had > 0) return { ...r, meaning: 'relay' };
  if (pos < 7) {
    const o = opposite(pos);
    const oppBurnt = isBurnt(burnt, o);
    if (!oppBurnt && s[o] > 0) return { ...r, meaning: 'capture', opp: o, oppShells: s[o] };
    return { ...r, meaning: 'dud', opp: o, oppBurnt };
  }
  return { ...r, meaning: 'end' };
}

export function firstHandfulText(p) {
  const ulo = p.meaning === 'extra' ? p.passUlo > 1 : p.passUlo > 0;
  const onTheWay = ulo ? ' It also drops one in your ulo on the way.' : '';
  const L = slotName(p.lands);
  if (p.meaning === 'extra') return `It ends in your ulo: extra turn.${onTheWay}`;
  if (p.meaning === 'relay') return `It ends in ${L}, which already has shells: relay.${onTheWay}`;
  if (p.meaning === 'capture') return `It ends in your empty ${L}; ${slotName(p.opp)} opposite has ${p.oppShells}: you'd capture ${p.oppShells + 1}.${onTheWay}`;
  if (p.meaning === 'dud') return `It ends in your empty ${L}; ${slotName(p.opp)} opposite is ${p.oppBurnt ? 'burnt' : 'empty'}: dud, the turn ends.${onTheWay}`;
  return `It ends in Lola's empty ${L}: the turn ends.${onTheWay}`;
}

// WHOLE-SOWING preview: the engine's full sowing (all relays), plus the slot each handful stopped in.
export function wholeSowing(state, burnt, house, next = nextTable(burnt)) {
  const r = sow(state, burnt, house, next);
  const stops = [];
  let pos = house;
  for (const size of r.handfuls) {
    for (let k = 0; k < size; k++) pos = next[pos];
    stops.push(pos);
  }
  if (pos !== r.last) throw new Error(`walk ended at ${pos}, engine at ${r.last}`);
  return { ...r, house, stops, burnt };
}

export function wholeSowingText(w) {
  const relayAt = w.stops.slice(0, -1).map(slotName);
  const via = relayAt.length ? `It relays at ${relayAt.join(', ')}, then ends` : 'It ends';
  const L = slotName(w.last);
  const adds = `This sowing adds ${w.gained} to your ulo.`;
  if (w.outcome === 'extra') return `${via} in your ulo: extra turn. ${adds}`;
  if (w.outcome === 'capture') {
    const o = opposite(w.last);
    return `${via} in your empty ${L}; ${slotName(o)} opposite had ${w.captured - 1}: capture ${w.captured}, the turn ends. ${adds}`;
  }
  if (w.outcome === 'dud') {
    const o = opposite(w.last);
    return `${via} in your empty ${L}; ${slotName(o)} opposite is ${isBurnt(w.burnt, o) ? 'burnt' : 'empty'}: dud, the turn ends. ${adds}`;
  }
  return `${via} in Lola's empty ${L}: the turn ends. ${adds}`;
}
