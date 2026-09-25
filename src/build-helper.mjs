// node src/build-helper.mjs -> helper.html
// A self-contained facilitator page (works offline from file://). It inlines engine.mjs and
// preview.mjs verbatim (import lines dropped, `export ` stripped) so it runs the exact rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { boards } from './build-boards.mjs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  .split('\n').filter((l) => !/^import\s/.test(l)).join('\n').replace(/^export /gm, '');
const lib = ['./engine.mjs', './preview.mjs', './helper-data.mjs', './modes.mjs'].map(src).join('\n');
const dayName = { M: 'Monday', W: 'Wednesday', S: 'Saturday' };
const data = boards.map((b) => ({ code: b.code, day: dayName[b.code[0]], par: b.par, perfectLines: b.perfectLines, board: b.board }));

const ui = String.raw`
const BOARDS = ${JSON.stringify(data)};
const q = new URLSearchParams(location.search);
const st = { group: q.get('group') === 'B' ? 'B' : 'A', code: BOARDS.some((b) => b.code === q.get('board')) ? q.get('board') : 'M1', override: null, attempt: 1, moves: [] };
if (q.get('moves')) st.moves = q.get('moves').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
const $ = (id) => document.getElementById(id);
const board = () => BOARDS.find((b) => b.code === st.code);
const mode = () => st.override || modeFor(st.group, st.code);

function play() {
  let { s, burnt } = toState(board().board);
  let score = 0, ended = false, swept = 0;
  const log = [];
  for (const m of st.moves) {
    const w = wholeSowing(s, burnt, m);
    log.push(w); score += w.gained; s = w.state;
    if (w.outcome !== 'extra') { ended = true; break; }
  }
  if (!ended && st.moves.length && legalHouses(s, burnt).length === 0) ended = true;
  if (ended) { const t = turnEnd(s, burnt); swept = t.swept; score += swept; s = t.state; }
  return { s, burnt, score, ended, swept, log };
}

function cell(s, burnt, i) {
  return isBurnt(burnt, i) ? '<div class="h burnt">##<small>' + slotName(i) + '</small></div>'
    : '<div class="h">' + s[i] + '<small>' + slotName(i) + '</small></div>';
}

function render() {
  const b = board(), p = play(), m = mode();
  $('groups').innerHTML = ['A', 'B'].map((g) => '<button data-group="' + g + '" class="' + (g === st.group ? 'on' : '') + '">Group ' + g + '</button>').join('');
  $('boards').innerHTML = BOARDS.map((x) => '<button data-board="' + x.code + '" class="' + (x.code === st.code ? 'on' : '') + '">' + x.code + '</button>').join('');
  $('mode').innerHTML = '<span class="badge ' + m + '">' + MODE_NAME[m].toUpperCase() + ' PREVIEW</span>'
    + (st.override ? ' <span class="muted">(override; the table says ' + MODE_NAME[modeFor(st.group, st.code)] + ')</span>' : ' <span class="muted">from the group table</span>')
    + ' <button data-toggle="1" class="small">switch</button>';
  $('info').innerHTML = '<b>Board ' + b.code + '</b> &middot; ' + b.day + ' &middot; par <b>' + b.par + '</b> &middot; attempt <b>' + st.attempt + '</b> of 3 &middot; banked this turn <b>' + p.score + '</b>';
  const top = [14, 13, 12, 11, 10, 9, 8].map((i) => cell(p.s, p.burnt, i)).join('');
  const bot = [0, 1, 2, 3, 4, 5, 6].map((i) => cell(p.s, p.burnt, i)).join('');
  $('board').innerHTML = '<div class="lola-ulo">Lola\'s ulo<br><small>never sown</small></div><div class="rows"><div class="row">' + top + '</div><div class="row">' + bot + '</div></div><div class="ulo">your ulo<br><b>+' + p.score + '</b></div>';

  let turn;
  if (p.ended) {
    const reached = p.score >= b.par;
    turn = '<div class="over ' + (reached ? 'yes' : 'no') + '"><b>Turn over: ' + p.score + ' of par ' + b.par + ' ' + (reached ? '&#10003; reached par' : '&#10007; below par') + '</b>'
      + (p.swept ? ' (includes a sweep of ' + p.swept + ')' : '')
      + '<br>Write on the sheet: <b>' + st.moves.map((h) => 'Y' + h).join(' ') + '</b>, score <b>' + p.score + '</b>.'
      + '<div class="acts">' + (st.attempt < 3 && !reached ? '<button data-next="1">Start attempt ' + (st.attempt + 1) + '</button>' : '<span class="muted">Board finished. Pick the next board above.</span>') + ' <button data-undo="1">Undo last sowing</button></div></div>';
  } else {
    const legal = legalHouses(p.s, p.burnt);
    turn = '<h3>' + (st.moves.length ? 'Extra turn: the tester must choose again' : 'Tester chooses a house') + '</h3>'
      + '<p class="muted">When the tester points at a house, read its line aloud, word for word. Nothing else.</p>'
      + legal.map((h) => {
        const t = m === 'FH' ? firstHandfulText(firstHandful(p.s, p.burnt, h)) : wholeSowingText(wholeSowing(p.s, p.burnt, h));
        return '<div class="opt"><div class="oh">Y' + h + ' <small>(' + p.s[h] + ')</small></div><div class="say">&ldquo;' + t + '&rdquo;</div><button data-sow="' + h + '">Tester sows Y' + h + '</button></div>';
      }).join('')
      + (st.moves.length ? '<div class="acts"><button data-undo="1">Undo last sowing</button></div>' : '');
  }
  $('turn').innerHTML = turn;
  $('log').innerHTML = p.log.length ? '<h3>This attempt so far (facilitator only; do not read aloud)</h3><ol>' + p.log.map((w) => '<li><b>Y' + w.house + '</b> (' + w.handfuls[0] + '): ' + wholeSowingText(w) + '</li>').join('') + '</ol>' : '';
  document.title = 'Helper ' + b.code + ' ' + (p.ended ? 'score ' + p.score : 'attempt ' + st.attempt);
}

document.addEventListener('click', (e) => {
  const d = e.target.closest('button')?.dataset;
  if (!d) return;
  if (d.group) { st.group = d.group; st.override = null; }
  if (d.board) { st.code = d.board; st.override = null; st.attempt = 1; st.moves = []; }
  if (d.toggle) st.override = mode() === 'FH' ? 'WS' : 'FH';
  if (d.sow !== undefined) st.moves.push(Number(d.sow));
  if (d.undo) st.moves.pop();
  if (d.next) { st.attempt++; st.moves = []; }
  render();
});
render();
`;

const css = `
:root { --ink:#231c14; --muted:#6b5e4f; --line:#3b2f22; --paper:#fffdf8; --ground:#efe9df; --fh:#2f5d8a; --ws:#8a4b2f; color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; padding:16px; background:var(--ground); color:var(--ink); font:15px/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif; }
main { max-width:980px; margin:0 auto; }
h1 { font:700 22px Georgia, serif; margin:0 0 2px; }
h3 { font:700 16px Georgia, serif; margin:14px 0 4px; }
.muted { color:var(--muted); }
.bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:8px 0; }
button { font:inherit; padding:6px 12px; border:1.5px solid var(--line); background:var(--paper); border-radius:6px; cursor:pointer; }
button.on { background:var(--line); color:var(--paper); }
button.small { padding:2px 8px; font-size:13px; }
.badge { display:inline-block; padding:4px 10px; border-radius:6px; color:#fff; font-weight:700; letter-spacing:.05em; }
.badge.FH { background:var(--fh); } .badge.WS { background:var(--ws); }
#board { display:flex; align-items:stretch; gap:8px; margin:12px 0; overflow-x:auto; background:#f6ecda; border:2px solid var(--line); border-radius:60px; padding:12px 18px; }
.rows { display:flex; flex-direction:column; gap:10px; }
.row { display:flex; gap:8px; }
.h { width:62px; height:62px; border:2px solid var(--line); border-radius:50%; background:var(--paper); display:flex; flex-direction:column; align-items:center; justify-content:center; font:700 22px Arial, sans-serif; flex:none; }
.h small { font:600 11px Arial, sans-serif; color:var(--muted); }
.h.burnt { background:repeating-linear-gradient(45deg,#e6e0d6 0 4px,#b9ad9c 4px 7px); font-size:15px; }
.ulo, .lola-ulo { display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; width:84px; border:2px solid var(--line); border-radius:40px; background:var(--paper); font:700 14px Georgia, serif; flex:none; }
.lola-ulo { border-style:dashed; color:var(--muted); font-weight:400; }
.ulo b { font:700 24px Arial, sans-serif; }
.opt { display:grid; grid-template-columns:70px 1fr auto; gap:10px; align-items:center; background:var(--paper); border:1.5px solid #cfc4b3; border-radius:8px; padding:8px 10px; margin:6px 0; }
.oh { font:700 18px Arial, sans-serif; } .oh small { font-weight:400; color:var(--muted); font-size:13px; }
.say { font-size:17px; }
.over { padding:12px 14px; border-radius:8px; border:2px solid var(--line); background:var(--paper); margin:10px 0; }
.over.yes { border-color:#2e7d4f; } .over.no { border-color:#a33b2b; }
.acts { margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
#log ol { padding-left:20px; margin:4px 0; } #log li { margin:3px 0; }
@media (max-width: 640px) { .opt { grid-template-columns:1fr; } }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isang Tira facilitator helper</title>
<style>${css}</style>
</head>
<body>
<main>
<h1>Isang Tira &middot; facilitator helper</h1>
<p class="muted">For the facilitator's laptop. Pick the tester's group and the board. The helper shows the preview line for each house in the mode that board uses; read it aloud word for word when the tester points at that house. When the tester commits, click <i>Tester sows</i> and let them sow the counters on paper. If their counters disagree with the board here, fix the counters to match. Runs offline, using the same rules engine as the spike.</p>
<div class="bar" id="groups"></div>
<div class="bar" id="boards"></div>
<div class="bar" id="mode"></div>
<div id="info"></div>
<div id="board"></div>
<div id="turn"></div>
<div id="log"></div>
</main>
<script>
${lib}
${ui}
</script>
</body>
</html>
`;
writeFileSync(new URL('../helper.html', import.meta.url), html);
console.log(`wrote helper.html (${(html.length / 1024).toFixed(1)} KB, ${data.length} boards)`);
