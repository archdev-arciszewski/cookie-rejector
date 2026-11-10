// Test end-to-end: uruchamia prawdziwą przeglądarkę (headless, tymczasowy profil), instaluje zbudowane
// rozszerzenie i sprawdza scenariusze ze strony test/index.html?ext=1.
//
//   python build.py
//   python test/serve.py 8765            (z katalogu nadrzędnego wobec repo albo z repo — patrz BASE)
//   node test/e2e.mjs firefox "C:\Program Files\Mozilla Firefox\firefox.exe"
//   node test/e2e.mjs chromium "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
//
// Wymaga Node 22+ (wbudowany WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , kind, exe] = process.argv;
const BASE = process.env.CCR_BASE || 'http://localhost:8765/cookie-rejector/test/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [case, oczekiwanie, czas oczekiwania ms]
const CASES = [
  ['onetrust', r => r.clicked?.what === 'save' && r.clicked.state.c3 === true && !r.clicked.state.c2 && !r.clicked.state.c4 && !r.clicked.state.c5, 15000],
  ['tcf', r => r.clicked?.what === 'save' && Object.values(r.clicked.state).filter(v => v.endsWith(':true')).join() === 'Zgoda:true', 15000],
  ['reject', r => r.clicked?.what === 'reject', 5000],
  ['info', r => r.bannerHidden && !r.clicked, 5000],
  ['pay', r => r.prompt && !r.clicked, 5000],
  ['wall', r => r.prompt && !r.clicked, 5000],
  ['wp', r => r.prompt && !r.clicked && r.wpSaved?.every(v => v === 'false'), 12000]
];

const PROBE = `JSON.stringify({
  clicked: window.__clicked || null,
  wpSaved: window.__wpSaved || null,
  prompt: !!document.getElementById('ccr-wall-prompt'),
  toast: !!document.getElementById('ccr-toast'),
  bannerHidden: (() => { const b = document.querySelector('#app > div'); return !!b && getComputedStyle(b).display === 'none'; })()
})`;

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      (m.error ? rej(new Error(JSON.stringify(m.error) + ' ' + (m.message || ''))) : res(m.result));
    } else events.push(m);
  });
  return {
    events,
    send(method, params = {}, extra = {}) {
      return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...extra })); });
    }
  };
}

async function openWs(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const ws = new WebSocket(url);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      return ws;
    } catch { await sleep(500); }
  }
  throw new Error('nie udało się połączyć: ' + url);
}

async function runFirefox(profile) {
  const port = 9333;
  const proc = spawn(exe, ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)], { stdio: 'ignore' });
  const ws = await openWs(`ws://127.0.0.1:${port}/session`);
  const c = rpc(ws);
  await c.send('session.new', { capabilities: {} });
  const ext = await c.send('webExtension.install', { extensionData: { type: 'path', path: join(ROOT, 'dist', 'firefox') } });
  console.log('zainstalowano dodatek:', ext.extension);
  const tree = await c.send('browsingContext.getTree', {});
  const context = tree.contexts[0].context;
  const run = async (url, wait) => {
    await c.send('browsingContext.navigate', { context, url, wait: 'complete' });
    await sleep(wait);
    const r = await c.send('script.evaluate', { expression: PROBE, target: { context }, awaitPromise: false });
    return JSON.parse(r.result.value);
  };
  return { run, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

async function runChromium(profile) {
  const port = 9334;
  const extPath = ROOT;
  const proc = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
    `--load-extension=${extPath}`, `--disable-extensions-except=${extPath}`, 'about:blank'
  ], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(500); } }
  if (!ver) throw new Error('przeglądarka nie wystartowała');
  console.log('przeglądarka:', ver.Browser);
  let targets = [], sw;
  for (let i = 0; i < 20 && !sw; i++) {
    await sleep(500);
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    sw = targets.find(t => /^(chrome-)?extension:\/\/[a-z]+\/src\/background\.js$/.test(t.url));
  }
  console.log('rozszerzenie załadowane:', sw ? sw.url : 'NIE');
  const page = targets.find(t => t.type === 'page');
  const ws = await openWs(page.webSocketDebuggerUrl);
  const c = rpc(ws);
  await c.send('Page.enable');
  const run = async (url, wait) => {
    await c.send('Page.navigate', { url });
    await sleep(wait + 800);
    const r = await c.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    return JSON.parse(r.result.value);
  };
  return { run, loaded: !!sw, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const profile = mkdtempSync(join(tmpdir(), 'ccr-e2e-'));
let browser;
let failed = 0;
try {
  browser = kind === 'firefox' ? await runFirefox(profile) : await runChromium(profile);
  if (browser.loaded === false) throw new Error('rozszerzenie się nie załadowało');
  await browser.run(`${BASE}?ext=1&case=none`, 2000); // rozgrzewka (start tła rozszerzenia)
  for (const [name, check, wait] of CASES) {
    const r = await browser.run(`${BASE}?ext=1&case=${name}`, wait);
    const ok = check(r);
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(9)} ${JSON.stringify(r)}`);
  }
} catch (e) {
  failed++;
  console.error('BŁĄD:', e.message);
} finally {
  browser && browser.close();
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} nieudanych` : '\nwszystkie scenariusze OK');
process.exit(failed ? 1 : 0);
