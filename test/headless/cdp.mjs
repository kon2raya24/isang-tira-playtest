// Minimal DevTools-protocol driver for headless Chrome checks. Unlike --virtual-time-budget runs,
// the page runs on the wall clock and is visible, so Web Animations advance normally.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openChrome(port = 9337) {
  const profile = mkdtempSync(join(tmpdir(), 'itira-cdp-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let url = null;
  for (let i = 0; i < 50 && !url; i++) {
    try {
      url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch { /* not up yet */ }
    if (!url) await sleep(200);
  }
  if (!url) { proc.kill(); throw new Error('Chrome DevTools did not come up'); }
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  return {
    cdp,
    evaluate,
    async viewport(width, height, mobile = false) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    },
    async load(url, media = []) {
      await cdp('Emulation.setEmulatedMedia', { features: media });
      await cdp('Page.navigate', { url });
      await sleep(400);
    },
    // key('Enter', { text: '\r', keyCode: 13 }), key('1', { modifiers: 4 }) for Meta+1.
    async key(key, { code = key, keyCode = 0, modifiers = 0, autoRepeat = false, text } = {}) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, autoRepeat, ...(text && !modifiers ? { text } : {}) });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    },
    async click(x, y, clickCount = 1) {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    },
    async clickSelector(selector, clickCount = 1) {
      const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
      await this.click(r[0], r[1], clickCount);
    },
    async close() {
      ws.close();
      proc.kill();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
