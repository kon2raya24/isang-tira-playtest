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
