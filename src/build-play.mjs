// node src/build-play.mjs -> play.html
// A self-contained playtest page (works offline from file://). It inlines the rules engine and the
// pure modules verbatim (import lines dropped, `export ` stripped), like build-helper.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { boards } from './build-boards.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const inline = (rel) => read(rel).split('\n').filter((l) => !/^import\s/.test(l)).join('\n').replace(/^export /gm, '');
const LIB = ['./engine.mjs', './preview.mjs', './helper-data.mjs', './modes.mjs', './events.mjs', './timing.mjs', './demos.mjs', './session.mjs']
  .map(inline).join('\n');
const dayName = { M: 'Monday', W: 'Wednesday', S: 'Saturday' };
const DATA = {
  boards: boards.map((b) => ({
    code: b.code,
    day: dayName[b.code[0]],
    par: b.par,
    perfectLines: b.perfectLines,
    board: b.board,
    lines: b.lines.map((l) => l.moves.map((m) => Number(m.slice(1)))),
  })),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isang Tira playtest: play in your browser</title>
<style>
${read('./play/style.css')}
</style>
</head>
<body>
<main id="app" class="app"></main>
<div id="live" class="sr-only" aria-live="polite"></div>
<noscript><p style="padding:16px">This playtest needs JavaScript. The printable version is at <a href="boards.html">boards.html</a>.</p></noscript>
<script>
(() => {
'use strict';
const DATA = ${JSON.stringify(DATA)};
${LIB}
${read('./play/app.js')}
})();
</script>
</body>
</html>
`;
writeFileSync(new URL('../play.html', import.meta.url), html);
console.log(`wrote play.html (${(html.length / 1024).toFixed(1)} KB, ${DATA.boards.length} boards)`);
