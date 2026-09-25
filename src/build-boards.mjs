// node src/build-boards.mjs --public -> boards.html (public, no answer key)
// node src/build-boards.mjs          -> private/boards-full.html (answer key; gitignored and vercelignored)
// Boards come from results/picks.json (analysis/pick-boards.mjs: fixed typicality rule, Wednesday stratified).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MODES, MODE_NAME } from './modes.mjs';

const P = JSON.parse(readFileSync(new URL('./data/playtest-boards.json', import.meta.url), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Board order: Monday warm-up, Wednesday (G3 day; solved/unsolved-by-preview interleaved), Saturday.
const W = P.playtest.Wednesday.picks;
const wed = [W[0], W[2], W[1], W[3]];
export const boards = [
  ...P.playtest.Monday.picks.map((b, i) => ({ ...b, code: `M${i + 1}` })),
  ...wed.map((b, i) => ({ ...b, code: `W${i + 1}` })),
  ...P.playtest.Saturday.picks.map((b, i) => ({ ...b, code: `S${i + 1}` })),
];
if (boards.length !== 10) throw new Error('expected 10 boards');

// ---------- the board drawing (inline SVG) ----------
// Lola row on top, L6..L0 left to right (L0 next to your ulo on the right); your row Y0..Y6 beneath; your ulo right.
export function boardSvg(b) {
  const X = (i) => 170 + i * 92; // column i: L(6-i) above Y(i)
  const yTop = 92, yBot = 218, r = 34;
  const house = (v, x, y, label, labelY) => {
    const burnt = v === 'x';
    return `<g>${burnt
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#hatch-${b.code})" stroke="#3b2f22" stroke-width="2.5"/><path d="M${x - 17} ${y - 17}L${x + 17} ${y + 17}M${x + 17} ${y - 17}L${x - 17} ${y + 17}" stroke="#3b2f22" stroke-width="4" stroke-linecap="round"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="#fffdf8" stroke="#3b2f22" stroke-width="2.5"/><text x="${x}" y="${y + 12}" class="n">${v}</text>`}
      <text x="${x}" y="${labelY}" class="lbl">${label}${burnt ? ' burnt' : ''}</text></g>`;
  };
  const chev = (x, y, dir) => `<path d="M${x - 5 * dir} ${y - 7}L${x + 5 * dir} ${y}L${x - 5 * dir} ${y + 7}" class="chev"/>`;
  let s = `<svg viewBox="0 0 900 312" class="board" role="img" aria-label="Sungka board ${b.code}">
  <defs><pattern id="hatch-${b.code}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e6e0d6"/><line x1="0" y1="0" x2="0" y2="8" stroke="#8c8173" stroke-width="3"/></pattern></defs>
  <rect x="6" y="46" width="888" height="218" rx="104" fill="#f6ecda" stroke="#3b2f22" stroke-width="3"/>
  <ellipse cx="66" cy="155" rx="36" ry="84" fill="#ece3d2" stroke="#8c8173" stroke-width="2" stroke-dasharray="6 5"/>
  <text x="66" y="150" class="ulo-s">Lola's</text><text x="66" y="168" class="ulo-s">ulo</text><text x="66" y="186" class="ulo-xs">never sown</text>
  <ellipse cx="832" cy="155" rx="44" ry="92" fill="#fffdf8" stroke="#3b2f22" stroke-width="3"/>
  <text x="832" y="150" class="ulo">YOUR</text><text x="832" y="172" class="ulo">ULO</text>`;
  for (let i = 0; i < 7; i++) s += house(b.board.L[6 - i], X(i), yTop, `L${6 - i}`, 30);
  for (let i = 0; i < 7; i++) s += house(b.board.Y[i], X(i), yBot, `Y${i}`, 298);
  for (let i = 0; i < 6; i++) { s += chev(X(i) + 46, yBot, 1); s += chev(X(i) + 46, yTop, -1); }
  s += chev(X(6) + 52, yBot, 1) + chev(X(6) + 52, yTop, -1);
  // L6 -> Y0, passing Lola's ulo by (dashed, with a downward chevron at its end)
  const wx = X(0) - 50;
  s += `<path d="M${wx + 6} ${yTop + 2} C ${wx - 14} ${yTop + 40}, ${wx - 14} ${yBot - 40}, ${wx + 6} ${yBot - 14}" class="wrap"/>`
    + `<path d="M${wx - 3} ${yBot - 22}L${wx + 6} ${yBot - 12}L${wx + 13} ${yBot - 24}" class="chev"/>`;
  return `${s}</svg>`;
}

// ---------- answer-key text ----------
const slot = (n) => (n === 'ulo' ? 'your ulo' : n);
function stepHtml(t, k) {
  const parts = t.handfuls.map((h, i) => {
    const head = i === 0 ? `<b>${t.house}</b> (${h.size})` : `relay ${h.size}`;
    const pass = h.meaning === 'extra' ? (h.passUlo > 1 ? `, passing your ulo on the way (+${h.passUlo - 1})` : '') : (h.passUlo ? `, passing your ulo (+${h.passUlo})` : '');
    const what = h.meaning === 'extra' ? '<b>your ulo</b>: extra turn'
      : h.meaning === 'relay' ? `<b>${h.lands}</b> (had ${h.had})`
      : h.meaning === 'capture' ? `<b>${h.lands}</b> (empty): captures ${h.oppName}'s ${h.captured} + 1 = ${h.captured + 1}`
      : h.meaning === 'dud' ? `<b>${h.lands}</b> (empty): dud, ${h.oppName} ${h.oppBurnt ? 'burnt' : 'empty'}`
      : `<b>${h.lands}</b> (empty Lola house): turn ends`;
    return `${head} &rarr; ${what}${pass}`;
  });
  return `<li>${parts.join(' &rarr; ')} <span class="gain">+${t.gained}</span></li>`;
}
function lineHtml(l, title) {
  return `<div class="kline"><div class="kline-h">${title}: <b>${l.moves.join(' ')}</b> = ${l.score}${l.relaySegments !== undefined ? ` <span class="muted">(${l.relaySegments} relay${l.relaySegments === 1 ? '' : 's'}, largest handful ${l.maxHandful}, ${l.totalDrops} drops)</span>` : ''}</div><ol>${l.steps.map(stepHtml).join('')}</ol>${l.swept ? `<div>Turn ends: sweep +${l.swept}</div>` : ''}</div>`;
}
function openingHtml(b) {
  return b.opening.map((o) => {
    const pass = o.passUlo && o.meaning !== 'extra' ? `passes your ulo (+${o.passUlo}), ` : o.meaning === 'extra' && o.passUlo > 1 ? `passes your ulo (+${o.passUlo - 1}), ` : '';
    const says = o.meaning === 'extra' ? `${pass}ends in your ulo: <b>extra turn</b>`
      : o.meaning === 'relay' ? `${pass}ends in ${o.lands}, which already has shells: <b>relay</b>`
      : o.meaning === 'capture' ? `${pass}ends in ${o.lands}, empty; ${o.oppName} opposite has ${o.captured}: <b>capture ${o.captured + 1}</b>`
      : o.meaning === 'dud' ? `${pass}ends in ${o.lands}, empty; ${o.oppName} opposite is empty: <b>dud, turn ends</b>`
      : `${pass}ends in ${o.lands}, an empty Lola house: <b>turn ends</b>`;
    return `<li><b>${o.house}</b> (${o.size}): ${says}</li>`;
  }).join('');
}

// ---------- pages ----------
const dayName = { M: 'Monday', W: 'Wednesday', S: 'Saturday' };
const attempt = (k) => `<div class="attempt">
  <div class="att-h"><span class="att-n">Attempt ${k}</span><span class="fill">Start time <i></i></span></div>
  <div class="row"><span class="cap">Houses in the order you chose them</span><span class="seq">${'<i></i>'.repeat(9)}</span></div>
  <div class="row"><span class="cap">Score</span><span class="box"></span><span class="cap">Reached par?</span><span class="tick">&#9744; yes &nbsp; &#9744; no</span></div>
  <div class="row"><span class="cap">How did you choose?</span><span class="tick">&#9744; worked it out &nbsp; &#9744; partly guessed &nbsp; &#9744; guessed</span></div>
  <div class="row notes"><span class="cap">Notes</span><i></i></div>
</div>`;
const boardPage = (b) => `<section class="page">
  <header class="ph"><div><div class="kicker">Isang Tira &middot; paper playtest</div><h2>Board ${b.code} <span class="day">${dayName[b.code[0]]}</span></h2></div>
  <div class="par"><div class="par-n">${b.par}</div><div class="par-l">PAR<br><span>best possible score</span></div></div></header>
  <div class="who"><span>Tester <i></i></span><span>Facilitator <i></i></span><span>Date <i></i></span></div>
  ${b.code[0] === 'M' ? '' : `<div class="modebox"><span class="cap">Group</span><span class="tick">&#9744; A &nbsp; &#9744; B</span><span class="cap">Preview mode</span><span class="tick">&#9744; first handful &nbsp; &#9744; whole sowing</span><span class="muted">A: ${MODE_NAME[MODES.A[b.code]]} &middot; B: ${MODE_NAME[MODES.B[b.code]]}</span></div>`}
  ${boardSvg(b)}
  <p class="remind">Take one whole turn. Score = shells you add to <b>your ulo</b>. Path: Y0 &rarr; Y6 &rarr; your ulo &rarr; L0 &rarr; L6 &rarr; Y0 (Lola's ulo is never sown${b.board.Y.concat(b.board.L).includes('x') ? '; burnt houses are skipped' : ''}). Ask the facilitator to preview a house before you commit to it. Up to three attempts; reset the board between attempts.</p>
  ${attempt(1)}${attempt(2)}${attempt(3)}
</section>`;

const keyBlock = (b) => `<div class="key">
  <div class="key-h"><h3>${b.code} &middot; ${dayName[b.code[0]]} &middot; par ${b.par}</h3><span class="muted">${b.perfectLines} perfect line${b.perfectLines === 1 ? '' : 's'} &middot; source ${b.seed} #${b.candidate}</span></div>
  <div class="mini">Y0-Y6: ${b.board.Y.join(' ')} &nbsp;&middot;&nbsp; L0-L6: ${b.board.L.join(' ')}</div>
  ${b.lines.map((l, i) => lineHtml(l, b.lines.length > 1 ? `Perfect line ${i + 1}` : 'Perfect line')).join('')}
  ${lineHtml({ ...b.greedyTrace, moves: b.greedyMoves, score: b.greedyScore }, `The obvious line (what a greedy player tries${b.greedyGap ? `; ${b.greedyGap} below par` : '; reaches par'})`)}
  <div class="crib"><div class="kline-h">Preview crib, opening position only (what you say if the tester points at each house)</div><ul>${openingHtml(b)}</ul></div>
  <div class="muted small">Proxies, not predictions: random play reaches par with probability ${b.randomParRate}; the preview-only bot scores ${b.preview.oneTryScore} on its first try and ${b.preview.within3 ? `reaches par on try ${b.preview.within3}` : 'does not reach par in 3 tries'}; the relay-aware greedy scores ${b.relayAwareScore}.</div>
</div>`;

const facilitator = `<section class="page fac">
  <header class="ph"><div><div class="kicker">Isang Tira &middot; paper playtest &middot; 10 boards</div><h2>Facilitator sheet</h2></div></header>
  <div class="cols">
  <div>
  <h4>What this session measures</h4>
  <ul>
   <li><b>G3:</b> on Wednesday boards W1-W4 played in <b>first-handful</b> mode, how often a tester reaches par on the <b>first</b> attempt. Target: 20-60% of first attempts.</li>
   <li><b>G4:</b> on relay days (Wednesday and Saturday), how often testers tick <i>guessed</i>. Target: fewer than half of attempts.</li>
   <li><b>Preview modes:</b> the same numbers in <b>whole-sowing</b> mode, to compare the two previews. See page 2.</li>
  </ul>
  <h4>Setup</h4>
  <ul>
   <li>Print the ten board pages for each tester. Keep the answer key (last pages) out of sight.</li>
   <li>Use counters (beans, coins, pebbles) on the drawn houses, or let the tester write the counts as they sow.</li>
   <li>Order: M1-M3 (warm-up; teach the rules here), then W1-W4, then S1-S3. Do not reveal the answer key between boards.</li>
  </ul>
  <h4>Rules to read aloud</h4>
  <ol class="rules">
   <li>You take <b>one turn</b>. Your score is the number of shells you put into <b>your ulo</b> during it. <b>Par</b> is the best score possible.</li>
   <li>Choose any house in <b>your row</b> (bottom) that has shells. Pick them all up and drop one in each slot along the path: Y0 &rarr; &hellip; &rarr; Y6 &rarr; your ulo &rarr; L0 &rarr; &hellip; &rarr; L6 &rarr; Y0 &hellip; Lola's ulo is never sown. Burnt houses are skipped.</li>
   <li>Where the <b>last</b> shell lands decides what happens:
    <ul>
     <li><b>your ulo</b>: extra turn. You must choose again, from any house of yours with shells.</li>
     <li>a house (either row) that <b>already had shells</b>: <b>relay</b>. Pick up everything in it and keep sowing from the next slot.</li>
     <li>an <b>empty house in your row</b>: if the Lola house opposite has shells, <b>capture</b> them and this last shell into your ulo; otherwise nothing happens (a dud). Either way, the turn ends.</li>
     <li>an <b>empty Lola house</b>: the turn ends.</li>
    </ul></li>
   <li>A handful big enough to go all the way round also drops into the house it came from.</li>
   <li>When the turn ends, if Lola's row is empty, every shell left in your row goes to your ulo. <span class="muted">(Facilitator note: this cannot happen on any of these ten boards.)</span></li>
  </ol>
  </div>
  <div>
  <h4>Acting as the preview: first-handful mode</h4>
  <p>The tester may point at a house and ask what it does <b>before</b> committing. Answer about the <b>first handful only</b>:</p>
  <ol class="rules">
   <li>Count the shells in the house (N). Starting from the next slot, count N slots along the path. Skip burnt houses and Lola's ulo. The house itself counts if the handful comes all the way round.</li>
   <li>Say where the last shell lands and what that means, in one of these forms:
    <ul class="say">
     <li>&ldquo;It ends in your ulo: extra turn.&rdquo;</li>
     <li>&ldquo;It ends in Y4, which already has shells: relay.&rdquo; <b>Stop there.</b></li>
     <li>&ldquo;It ends in your empty Y2; L4 opposite has 3: you'd capture 4.&rdquo;</li>
     <li>&ldquo;It ends in your empty Y2; L4 opposite is empty: dud, the turn ends.&rdquo;</li>
     <li>&ldquo;It ends in Lola's empty L3: the turn ends.&rdquo;</li>
    </ul></li>
   <li>If the handful passes your ulo, add &ldquo;&hellip; and it drops one in your ulo on the way.&rdquo;</li>
  </ol>
  <p><b>Never</b> say where a relay goes, whether a move is good, or compare houses. Preview as often as asked. The answer key has a crib for each board's opening position; after that, count it out, or use <b>helper.html</b> (page 2), which gives the exact line to read. Whole-sowing mode is on page 2.</p>
  <h4>Running each board</h4>
  <ul>
   <li>Up to three attempts. Reset the counters to the printed numbers before each attempt. Stop as soon as the tester reaches par.</li>
   <li>The tester sows; you check the counting. If a miscount changes the outcome, replay that sowing correctly and note it.</li>
   <li>After each attempt, ask <i>&ldquo;Did you work that out, or guess?&rdquo;</i> and tick the box they choose. Do not suggest an answer.</li>
   <li>Record the houses in order and the score. Check the score against the answer key; the key shows each perfect line step by step, and the obvious line most people try first.</li>
  </ul>
  <h4>Report back, per tester</h4>
  <ul>
   <li>W1-W4: par on attempt 1 (yes/no), attempts to par (1, 2, 3 or none).</li>
   <li>All W and S attempts: the <i>worked it out / partly guessed / guessed</i> tick.</li>
   <li>Minutes per board, and any rule the tester misunderstood.</li>
   <li>The tester's group and each board's preview mode (page 2).</li>
  </ul>
  </div>
  </div>
</section>`;


const modeRows = ['W1', 'W2', 'W3', 'W4', 'S1', 'S2', 'S3'].map((c) => `<tr><td>${c}</td><td>${MODE_NAME[MODES.A[c]]}</td><td>${MODE_NAME[MODES.B[c]]}</td></tr>`).join('');
const facilitator2 = `<section class="page fac">
  <header class="ph"><div><div class="kicker">Isang Tira &middot; paper playtest</div><h2>Facilitator sheet, page 2: two preview modes</h2></div></header>
  <div class="cols">
  <div>
  <h4>Why two modes</h4>
  <p>The spike's biggest open question is the preview.</p>
  <ul>
   <li><b>First handful:</b> you say only where the first handful ends, and stop at a relay. Counting relays is the tester's job.</li>
   <li><b>Whole sowing:</b> you say where the whole sowing ends, relays included, and how many shells it adds to the ulo. The puzzle becomes choosing the order.</li>
  </ul>
  <p>Each tester plays every Wednesday and Saturday board in one mode, following the table, so the two modes can be compared.</p>
  <h4>Groups</h4>
  <p>Put testers in Group A and Group B alternately as they arrive (A, B, A, B&hellip;). Monday boards always use first-handful mode.</p>
  <table class="modes"><tr><th>Board</th><th>Group A</th><th>Group B</th></tr>${modeRows}</table>
  <p class="muted">In each mode, each group gets one Wednesday board the preview-only bot solves and one it does not.</p>
  </div>
  <div>
  <h4>Using helper.html</h4>
  <ol class="rules">
   <li>Open <b>helper.html</b> (same folder as this pack) in a browser on your laptop. It works offline.</li>
   <li>Pick the tester's group and the board. The badge shows the mode for that board, taken from the table.</li>
   <li>When the tester points at a house, read that house's line aloud, word for word. Whole-sowing example: &ldquo;It relays at Y5, then ends in your ulo: extra turn. This sowing adds 1 to your ulo.&rdquo;</li>
   <li>When the tester commits, click <i>Tester sows</i> for that house and let them sow the counters. If the counters come out different from the helper's board, correct the counters.</li>
   <li>When the turn ends, the helper shows the score and the houses to write down. Use <i>Start attempt 2</i> for the next attempt, and <i>Undo last sowing</i> for a mis-click.</li>
  </ol>
  <p>Never read the other mode's line, and never say whether a move is good.</p>
  <h4>Report back, per tester (as well as page 1)</h4>
  <ul>
   <li>The group, and the preview mode ticked on each board page.</li>
   <li>At the end, ask: &ldquo;Which boards were more fun: the ones where I told you only the first handful, or the whole sowing? Why?&rdquo; Write the answer down in their words.</li>
  </ul>
  </div>
  </div>
</section>`;

const keySection = `<section class="page keypage"><header class="ph"><div><div class="kicker">Isang Tira &middot; paper playtest</div><h2>Answer key <span class="day">facilitator only</span></h2></div></header>
  <p class="muted small">Each step: the house chosen (shells in it) &rarr; where each handful ends &rarr; what happens. +N = shells added to your ulo by that sowing. A tester's score is the sum; par is the best possible.</p>
  ${boards.map(keyBlock).join('')}</section>`;

const css = `
:root { --ink:#231c14; --muted:#6b5e4f; --line:#3b2f22; --paper:#fffdf8; --ground:#e9e4da; color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; background:var(--ground); color:var(--ink); font: 10.5pt/1.38 "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width:210mm; min-height:297mm; margin:10mm auto; padding:12mm 13mm; background:var(--paper); box-shadow:0 1px 6px rgba(0,0,0,.18); break-after:page; page-break-after:always; }
.page:last-child { break-after:auto; page-break-after:auto; }
.keypage { min-height:0; }
@media screen and (max-width: 230mm) { .page { width:auto; min-height:0; margin:16px; padding:16px; } }
@page { size:A4 portrait; margin:12mm 13mm; }
@media print { body { background:none; } .page { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; background:none; } }
h2 { font: 700 20pt/1.1 Georgia, "Iowan Old Style", "Palatino Linotype", serif; margin:2px 0 0; }
h2 .day { font-weight:400; color:var(--muted); font-size:15pt; margin-left:6px; }
h3 { font: 700 13pt/1.2 Georgia, "Palatino Linotype", serif; margin:0; }
h4 { font: 700 10.5pt/1.2 Georgia, "Palatino Linotype", serif; margin:9px 0 3px; text-transform:uppercase; letter-spacing:.04em; }
.kicker { font-size:8.5pt; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.ph { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid var(--line); padding-bottom:6px; margin-bottom:8px; }
.par { display:flex; align-items:center; gap:8px; border:2.5px solid var(--line); border-radius:10px; padding:4px 12px; }
.par-n { font: 700 30pt/1 Georgia, serif; }
.par-l { font-weight:700; letter-spacing:.08em; font-size:10pt; line-height:1.1; }
.par-l span { font-weight:400; letter-spacing:0; font-size:8pt; color:var(--muted); }
.who { display:flex; gap:18px; font-size:9pt; color:var(--muted); margin-bottom:4px; }
.who span { flex:1; display:flex; gap:6px; }
.who i, .fill i { flex:1; border-bottom:1px solid #9a8c7a; min-width:30mm; }
.board { width:100%; height:auto; display:block; margin:2mm 0 1mm; }
.board .n { font: 700 34px/1 "Helvetica Neue", Arial, sans-serif; text-anchor:middle; fill:var(--ink); }
.board .lbl { font: 600 17px "Helvetica Neue", Arial, sans-serif; text-anchor:middle; fill:#4a3d2f; }
.board .ulo { font: 700 19px Georgia, serif; text-anchor:middle; fill:var(--ink); letter-spacing:.06em; }
.board .ulo-s { font: 600 14px Georgia, serif; text-anchor:middle; fill:#6b5e4f; }
.board .ulo-xs { font: italic 11px Georgia, serif; text-anchor:middle; fill:#6b5e4f; }
.board .chev { fill:none; stroke:#8c7a63; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
.board .wrap { fill:none; stroke:#8c7a63; stroke-width:2.5; stroke-dasharray:5 5; }
.remind { font-size:9pt; color:var(--muted); margin:0 0 4mm; }
.attempt { border:1.5px solid var(--line); border-radius:8px; padding:3.2mm 4mm; margin-bottom:3.4mm; }
.att-h { display:flex; justify-content:space-between; align-items:center; margin-bottom:2mm; }
.att-n { font: 700 12pt Georgia, serif; }
.fill { display:flex; gap:6px; font-size:9pt; color:var(--muted); width:55mm; }
.row { display:flex; align-items:center; gap:8px; margin:1.6mm 0; flex-wrap:wrap; }
.cap { font-size:9pt; color:var(--muted); }
.seq { display:flex; gap:2.2mm; flex:1; }
.seq i { flex:1; height:9mm; border:1px solid #9a8c7a; border-radius:3px; min-width:9mm; }
.box { width:18mm; height:9mm; border:1.5px solid var(--line); border-radius:3px; margin-right:6mm; }
.tick { font-size:10pt; }
.notes i { flex:1; border-bottom:1px solid #9a8c7a; height:6mm; }
.fac { font-size:9.2pt; line-height:1.33; }
.cols { display:grid; grid-template-columns:1fr 1fr; gap:7mm; }
.fac ul, .fac ol { margin:2px 0 4px; padding-left:15px; }
.fac li { margin:1.5px 0; }
.fac p { margin:3px 0; }
.rules > li { margin-bottom:3px; }
.say li { list-style:none; margin-left:-12px; font-style:italic; }
.modes { border-collapse:collapse; margin:3px 0 4px; width:100%; }
.modes th, .modes td { border:1px solid #9a8c7a; padding:2px 6px; text-align:left; }
.modes th { background:#efe7d8; }
.modebox { display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:9pt; border:1.5px dashed var(--line); border-radius:6px; padding:1.5mm 3mm; margin:1mm 0; }
.keypage { font-size:9pt; }
.key { border-top:1.5px solid var(--line); padding-top:3mm; margin-bottom:5mm; break-inside:avoid; }
.key-h { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
.mini { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:8.5pt; color:var(--muted); margin:1mm 0 2mm; }
.kline { margin:1.5mm 0; }
.kline-h { font-weight:600; }
.kline ol, .crib ul { margin:1mm 0 1mm; padding-left:18px; }
.kline li, .crib li { margin:.6mm 0; }
.gain { font-weight:700; white-space:nowrap; }
.muted { color:var(--muted); font-weight:400; }
.small { font-size:8pt; margin-top:1.5mm; }
`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isang Tira playtest pack</title>
<style>${css}</style>
</head>
<body>
${facilitator}
${facilitator2}
${boards.map(boardPage).join('\n')}
${keySection}
</body>
</html>
`;
// --public: the online copy. No answer key, and the sheet points at the local pack for it.
function publicCopy(html) {
  const swaps = [
    ['<li>Print the ten board pages for each tester. Keep the answer key (last pages) out of sight.</li>',
     '<li>Print the ten board pages for each tester. The answer key is not in this online copy; use your local <b>boards.pdf</b>.</li>'],
    ["The answer key has a crib for each board's opening position; after that, count it out, or use",
     'Count it out, or use'],
    ['<li>Record the houses in order and the score. Check the score against the answer key; the key shows each perfect line step by step, and the obvious line most people try first.</li>',
     '<li>Record the houses in order and the score. <b>helper.html</b> shows the score and whether it reached par.</li>'],
    [keySection, ''],
    ['<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"'],
  ];
  for (const [a, b] of swaps) {
    if (html.split(a).length !== 2) throw new Error(`public copy: expected exactly one match for ${a.slice(0, 50)}`);
    html = html.replace(a, () => b);
  }
  return html;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pub = process.argv.includes('--public');
  const file = pub ? '../boards.html' : '../private/boards-full.html';
  writeFileSync(new URL(file, import.meta.url), pub ? publicCopy(out) : out);
  console.log(`wrote ${file.slice(3)}: facilitator sheet + ${boards.length} boards (${boards.map((b) => b.code).join(' ')})${pub ? ', no answer key' : ' + answer key'}`);
}
