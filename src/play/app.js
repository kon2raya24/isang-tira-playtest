// Isang Tira digital playtest: screens, board, animation and sound.
// Rules come from the inlined engine. The animation only plays sowEvents(), so the screen can
// never disagree with the rules; session state lives in the pure session.mjs reducer.

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test') === '1';
const STORE_KEY = 'isangtira.playtest.v1';
const MUTE_KEY = 'isangtira.playtest.mute';
const RUNS_KEY = 'isangtira.playtest.runs';
const BOARDS = Object.fromEntries(DATA.boards.map((b) => [b.code, b]));
const PARS = Object.fromEntries(DATA.boards.map((b) => [b.code, b.par]));
const TOP = [14, 13, 12, 11, 10, 9, 8]; // Lola's row on screen: L6..L0, left to right
const BOTTOM = [0, 1, 2, 3, 4, 5, 6]; // your row: Y0..Y6
const SHELL_SPOTS = [[50, 28], [32, 42], [68, 42], [40, 62], [60, 62], [24, 24], [76, 24], [50, 78], [20, 60], [80, 60]];
const TICK_LABEL = { worked: 'Worked it out', partly: 'Partly guessed', guessed: 'Guessed' };
const OUTCOME_LESSON = {
  extra: 'Your last shell landed in your ulo, so you get an extra turn: isa pa!',
  capture: 'Your last shell landed in your own empty house, so you capture the Lola house opposite, plus that shell, and the turn ends.',
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

// lift > 0 arcs up, lift < 0 arcs down, 0 moves straight.
async function move(el, from, to, ms, lift = 18) {
  const mid = [(from[0] + to[0]) / 2, lift >= 0 ? Math.min(from[1], to[1]) - lift : Math.max(from[1], to[1]) - lift];
  const points = lift === 0 ? [from, to] : [from, mid, to];
  const a = el.animate(points.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })), { duration: ms, easing: 'ease-in-out' });
  el.style.transform = `translate(${to[0]}px, ${to[1]}px)`;
  await a.finished;
}

// The hand hovers in the channel between the rows, off the house's numeral: above your houses and
// the ulo, below Lola's houses.
const houseW = (ctx) => ctx.$b.querySelector('.h').getBoundingClientRect().width;
function handAt(ctx, slot) {
  const [x, y] = center(ctx, slot);
  const w = houseW(ctx);
  return [x, slot >= 8 && slot <= 14 ? y + 0.5 * w : y - 0.5 * w];
}
function newHand(ctx, cls, n, at) {
  const el = fxEl(ctx, cls, `<span>${n}</span>`, at);
  el.style.setProperty('--hand', `${Math.min(30, Math.round(0.6 * houseW(ctx)))}px`);
  return el;
}
const rowOf = (slot) => (slot <= 6 ? 'you' : slot >= 8 && slot <= 14 ? 'lola' : 'ulo');

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
      if (!hand && pos !== null) hand = newHand(ctx, 'hand', inHand, handAt(ctx, pos));
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
        const at = handAt(ctx, pos);
        hand = newHand(ctx, 'hand', inHand, at);
        const place = `translate(${at[0]}px, ${at[1]}px)`;
        await hand.animate([{ opacity: 0, transform: `${place} scale(0.4)` }, { opacity: 1, transform: `${place} scale(1)` }], { duration: ms(e) }).finished;
        break;
      case 'drop': {
        drops++;
        const rows = rowOf(pos) + rowOf(e.slot);
        await move(hand, handAt(ctx, pos), handAt(ctx, e.slot), ms(e), rows === 'youyou' ? 10 : rows === 'lolalola' ? -10 : 0);
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
        const [ux, uc] = center(ctx, ULO);
        const uy = uc - 0.3 * ctx.$b.querySelector('.ulo').getBoundingClientRect().height; // above the ulo total
        const st = fxEl(ctx, 'stamp', 'ISA PA!', [ux, uy]);
        const pose = (k) => `translate(${ux}px, ${uy}px) rotate(-8deg) scale(${k})`;
        st.style.transform = pose(1);
        await st.animate([{ opacity: 0, transform: pose(0.4) }, { opacity: 1, transform: pose(1.12), offset: 0.35 }, { opacity: 1, transform: pose(1), offset: 0.75 }, { opacity: 0, transform: pose(1) }], { duration: ms(e) }).finished;
        st.remove();
        break;
      }
      case 'capture':
      case 'sweep': {
        dropHand();
        const from = e.t === 'capture' ? e.opp : 3;
        const taken = e.t === 'capture' ? [e.opp, e.slot] : BOTTOM;
        taken.forEach((i) => ctx.$b.querySelector(`[data-slot="${i}"]`).classList.add('taken'));
        const chip = newHand(ctx, 'hand take', e.n, center(ctx, from));
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
  const tries = currentBoard(session).tries.length;
  announce(`Board ${code}, ${b.day}. Par ${b.par}. Preview: ${ui.mode === 'FH' ? 'first handful only' : 'whole sowing'}. ${isGuided()
    ? `Guided board: tap ${slotName(ui.guide[0])} to preview it, then tap it again to sow.`
    : `Try ${Math.min(tries + (session.phase === 'play' ? 1 : 0), MAX_TRIES)} of ${MAX_TRIES}.${tries && session.phase === 'play' ? ' The board is reset.' : ''}`}`);
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
      return `${res}<p class="q" id="tickq">How did you choose your moves this try?</p><div class="ticks" role="group" aria-labelledby="tickq" tabindex="-1">${TICKS.map((t) => `<button type="button" data-act="tick" data-tick="${t}">${TICK_LABEL[t]}</button>`).join('')}</div>`;
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
const focusPanel = () => ($('#panel .ticks') || $('#panel button'))?.focus({ preventScroll: true });

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
    <li>Last shell in <b>your own empty house</b>: capture Lola's house opposite, plus that shell. Nothing opposite? A dud. Either way, the turn ends.</li>
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
  let prev = null;
  try { prev = JSON.parse(store.get(RUNS_KEY) || 'null'); } catch { prev = null; }
  const run = nextRun(prev, location.search, Math.random);
  store.set(RUNS_KEY, JSON.stringify(run));
  session = newSession({
    tester: $('#initials')?.value ?? '',
    group: run.group,
    run: run.count,
    device: matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop',
    started: TEST ? 'TEST' : formatLocal(new Date()),
    now: Date.now(),
  });
  save();
  enterBoard();
}

function confirmRestart(btn) {
  const now = Date.now();
  const armedAt = Number(btn.dataset.armedAt || 0);
  if (!armedAt || now - armedAt > 5000) {
    btn.dataset.armedAt = String(now);
    btn.textContent = 'Tap again to erase your progress';
    return;
  }
  if (now - armedAt < 600) return; // a double-click is not a confirmation
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
  <header class="top"><div><div class="kicker">All ten boards done</div><h1 tabindex="-1">Your results</h1></div></header>
  <div class="scroll"><table class="res"><thead><tr><th scope="col">Board</th><th scope="col">Preview</th><th scope="col">Par</th><th scope="col">Scores</th><th scope="col">Par?</th><th scope="col">How you chose</th></tr></thead><tbody>${rows}</tbody></table></div>
  <fieldset class="pref"><legend>Which preview felt more fun?</legend>
    ${PREFS.map((p) => `<label><input type="radio" name="pref" value="${p}"${session.preferred === p ? ' checked' : ''}> ${p[0].toUpperCase()}${p.slice(1)}</label>`).join('')}
    <label class="field">Why? (optional)<textarea id="why" maxlength="280" rows="3">${esc(session.why)}</textarea></label>
  </fieldset>
  <div class="panel"><button type="button" class="primary" data-act="copy">Copy my results</button>${navigator.share ? '<button type="button" data-act="share">Share…</button>' : ''}<span id="copied" role="status"></span></div>
  <pre id="results-text" class="results-text">${esc(resultsText(session, PARS))}</pre>
  <div class="panel"><button type="button" data-act="replay" data-code="M1">Watch the perfect lines</button><button type="button" class="ghost" data-act="restart">Start over</button></div>`;
  $('h1').focus({ preventScroll: true });
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
  <header class="top"><div><div class="kicker">Perfect lines</div><h1 tabindex="-1">Board ${code}</h1></div><div class="par" role="img" aria-label="Par ${b.par}"><b>${b.par}</b><span>par</span></div></header>
  <div class="chips">${ORDER.map((c) => `<button type="button" class="chip${c === code ? ' on' : ''}" data-act="replay" data-code="${c}" aria-pressed="${c === code}">${c}</button>`).join('')}</div>
  <p>Perfect line: <b>${b.lines[0].map((h) => slotName(h)).join(' → ')}</b>${b.perfectLines > 1 ? ` (1 of ${b.perfectLines} perfect lines)` : ''}</p>
  ${boardHtml('b')}
  <p class="caption" id="caption"></p>
  <div class="panel"><button type="button" class="primary" data-act="replay-play" data-code="${code}">Play it</button><button type="button" class="ghost" data-act="results">Back to results</button></div>`;
  const { s, burnt } = toState(b.board);
  paint({ $b: $('#b'), s, burnt }, []);
  $('h1').focus({ preventScroll: true });
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
    say(`${slotName(h)}…`);
    await wait(reduced() ? 0 : 500);
    $h.classList.remove('sel');
    if (!(await animate(ctx, sowEvents(ctx.s, burnt, h).events))) return;
  }
  await animate(ctx, turnEndEvents(ctx.s, burnt).events);
  say(`Banked ${ctx.s[ULO]}: par.`);
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
  if (ev.repeat && /^([1-7]|Enter| )$/.test(ev.key)) { ev.preventDefault(); return; } // a held key never chooses or sows
  if (activeCtx && (ev.key === ' ' || ev.key === 'Enter')) activeCtx.speed = 4;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // leave browser shortcuts alone
  if (!ui || !ui.$b || !ui.$b.isConnected || !session || session.phase !== 'play' || ui.busy) return;
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
