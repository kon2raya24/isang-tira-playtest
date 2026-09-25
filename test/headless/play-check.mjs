// node test/headless/play-check.mjs [baseUrl] [outDir]
// Drives play.html through its ?test=1 hook in headless Chrome and checks the results against
// the session reducer. baseUrl defaults to the local file; outDir receives screenshots.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { plan, scriptFor, fullScript as script, expectedText } from './script.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const base = process.argv[2] || pathToFileURL(fileURLToPath(new URL('../../play.html', import.meta.url))).href;
const out = process.argv[3] || '.';
mkdirSync(out, { recursive: true });
const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=20000'];
const dump = (url) => execFileSync(CHROME, [...flags, '--dump-dom', url], { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'ignore'] });
const shot = (url, file, size) => execFileSync(CHROME, [...flags, `--window-size=${size}`, `--screenshot=${out}/${file}`, url], { timeout: 90_000, stdio: 'ignore' });
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const grab = (html, id) => { const m = html.replace(/<script[\s\S]*?<\/script>/g, '').match(new RegExp(`<pre[^>]*id="${id}"[^>]*>([\\s\\S]*?)</pre>`)); return m ? unesc(m[1]) : null; };
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const maskSecs = (t) => t.replace(/ \d+s\b/g, ' Ns');

for (const group of ['A', 'B']) {
  for (const mash of ['0', '1']) {
    const url = `${base}?test=1&group=${group}&mash=${mash}&prefer=ws&why=test%20run&script=${encodeURIComponent(script)}`;
    const html = dump(url);
    const err = grab(html, 'test-error');
    check(!err, `group ${group} mash=${mash}: playthrough runs without errors${err ? `\n${err}` : ''}`);
    const got = grab(html, 'results-text');
    check(got !== null && maskSecs(got) === maskSecs(expectedText(group)), `group ${group} mash=${mash}: results text matches the reducer`);
  }
}

// No spoilers before the end: mid-session DOMs never contain a later board's perfect line.
{
  const partial = scriptFor(plan.slice(0, 4));
  const html = dump(`${base}?test=1&group=A&script=${encodeURIComponent(partial)}`);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  check(!/Perfect line/i.test(visible) && !/data-act="replay"/.test(visible), 'no replay or perfect line is reachable mid-session');
}

// Layout at 360 px: measured inside a 360 px iframe (headless windows cannot go that narrow).
{
  const frame = `${out}/frame-360.html`;
  const src = (q) => `${base}?test=1&measure=1${q}`;
  writeFileSync(frame, `<!doctype html><body style="margin:0"><iframe src="${src('')}" style="width:360px;height:800px;border:0"></iframe>`
    + `<iframe src="${src(`&script=${encodeURIComponent('M1:auto')}`)}" style="width:360px;height:800px;border:0"></iframe>`
    + '<script>addEventListener("message", (e) => { const p = document.createElement("pre"); p.className = "m"; p.textContent = JSON.stringify(e.data.metrics); document.body.appendChild(p); });</script>');
  const html = dump(pathToFileURL(frame).href);
  const ms = [...html.matchAll(/<pre class="m">([^<]*)<\/pre>/g)].map((m) => JSON.parse(unesc(m[1])));
  check(ms.length === 2, `360 px: both screens measured (${ms.length})`);
  for (const m of ms) {
    check(m.scrollWidth <= m.clientWidth, `360 px ${m.screen}: no horizontal scroll (${m.scrollWidth} <= ${m.clientWidth})`);
    check(m.minHouse === null || m.minHouse >= 34, `360 px ${m.screen}: your-row houses >= 34 px (${m.minHouse})`);
  }
}

// Screenshots for a human look (desktop 1280x800; phone via a 360 px frame).
shot(`${base}?test=1`, 'play-start-desktop.png', '1280,900');
shot(`${base}?test=1&group=B&motion=1&freeze=3&script=${encodeURIComponent('M1:auto;M2:4')}`, 'play-midsow-desktop.png', '1280,900');
shot(`${base}?test=1&group=A&script=${encodeURIComponent(`M1:auto;M2:${plan[1].tries[0].moves.join('')}`)}`, 'play-tryresult-desktop.png', '1280,900');
shot(`${base}?test=1&group=A&prefer=ws&why=test&script=${encodeURIComponent(script)}`, 'play-results-desktop.png', '1280,1400');
const phoneFrame = `${out}/phone-360.html`;
writeFileSync(phoneFrame, `<!doctype html><body style="margin:0;background:#888;display:flex;gap:12px;padding:12px">${[
  '',
  `&group=B&freeze=3&script=${encodeURIComponent('M1:auto;M2:4')}`,
  `&group=A&prefer=ws&why=test&script=${encodeURIComponent(script)}`,
].map((q) => `<iframe src="${base}?test=1${q}" style="width:360px;height:900px;border:0;background:#fff"></iframe>`).join('')}`);
shot(pathToFileURL(phoneFrame).href, 'play-phone-360.png', '1140,930');
console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}; screenshots in ${out}`);
process.exit(failures ? 1 : 0);
