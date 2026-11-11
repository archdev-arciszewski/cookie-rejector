// Test end-to-end: uruchamia prawdziwą przeglądarkę (headless, tymczasowy profil), instaluje zbudowane
// rozszerzenie i sprawdza scenariusze ze strony test/index.html?ext=1.
//
//   python build.py --test-report-url http://127.0.0.1:18080/v1/report
//   python test/serve.py 8765            (z katalogu nadrzędnego wobec repo albo z repo — patrz BASE)
// Serwer zgłoszeń (server/index.mjs) test uruchamia sam, na porcie 18080, z tymczasowym katalogiem danych.
//   node test/e2e.mjs firefox "C:\Program Files\Mozilla Firefox\firefox.exe"
//   node test/e2e.mjs chromium "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
//
// Wymaga Node 22+ (wbudowany WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , kind, exe] = process.argv;
const BASE = process.env.CCR_BASE || 'http://localhost:8765/cookie-rejector/test/index.html';
// zgłoszenia wymagają prawdziwej domeny (serwer odrzuca localhost) — mapujemy ją na 127.0.0.1 w przeglądarce
const REPORT_HOSTS = ['ccr-e2e.example.com', 'ccr-e2e.example.org', 'ccr-e2e.example.net', 'ccr-e2e.example.edu'];
const onHost = (h, url) => url.replace('//localhost', '//' + h);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [case, oczekiwanie, czas oczekiwania ms]
const CASES = [
  ['onetrust', r => r.clicked?.what === 'save' && r.clicked.state.c3 === true && !r.clicked.state.c2 && !r.clicked.state.c4 && !r.clicked.state.c5, 15000],
  ['tcf', r => r.clicked?.what === 'save' && Object.values(r.clicked.state).filter(v => v.endsWith(':true')).join() === 'Zgoda:true', 15000],
  ['reject', r => r.clicked?.what === 'reject', 5000],
  ['info', r => r.bannerHidden && !r.clicked, 5000],
  ['pay', r => r.prompt && !r.clicked, 5000],
  ['wall', r => r.prompt && !r.clicked, 5000],
  ['wp', r => r.prompt && !r.clicked && r.wpSaved?.every(v => v === 'false'), 12000],
  ['cmp', r => r.clicked?.what === 'save' && r.clicked.cmpOn === 0 && !r.opisClicked && !r.report, 15000],
  ['shell', r => !r.clicked && !r.report && !r.prompt && !r.toast, 8000]
];

const PROBE = `JSON.stringify({
  vw: innerWidth, vh: innerHeight,
  report: !!document.getElementById('ccr-report'),
  rejectTried: window.__rejectTried || 0,
  toggleClicks: window.__toggleClicks || 0,
  opisClicked: window.__opisClicked || 0,
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
  writeFileSync(join(profile, 'user.js'), `user_pref("network.dns.localDomains", "${REPORT_HOSTS.join(',')}");\n`);
  const proc = spawn(exe, ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)], { stdio: 'ignore' });
  const ws = await openWs(`ws://127.0.0.1:${port}/session`);
  const c = rpc(ws);
  await c.send('session.new', { capabilities: {} });
  const ext = await c.send('webExtension.install', { extensionData: { type: 'path', path: join(ROOT, 'dist', 'test-firefox') } });
  console.log('zainstalowano dodatek:', ext.extension);
  const tree = await c.send('browsingContext.getTree', {});
  const context = tree.contexts[0].context;
  const run = async (url, wait) => {
    await c.send('browsingContext.navigate', { context, url, wait: 'complete' });
    await sleep(wait);
    return probe();
  };
  const probe = async () => {
    const r = await c.send('script.evaluate', { expression: PROBE, target: { context }, awaitPromise: false });
    return JSON.parse(r.result.value);
  };
  const clickAt = (x, y) => c.send('input.performActions', { context, actions: [{
    type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
    actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }]
  }] });
  return { run, probe, clickAt, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

async function runChromium(profile) {
  const port = 9334;
  const extPath = join(ROOT, 'dist', 'test-chromium');
  // pozostałość po poprzednim przebiegu na tym porcie dałaby wyniki innej przeglądarki
  const busy = () => fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
  for (let i = 0; i < 30 && await busy(); i++) await sleep(500); // poprzednia przeglądarka może jeszcze się zamykać
  if (await busy()) {
    throw new Error(`port ${port} jest zajęty przez inną przeglądarkę — zamknij ją i uruchom test ponownie`);
  }
  const proc = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
    `--load-extension=${extPath}`, `--disable-extensions-except=${extPath}`,
    `--host-resolver-rules=${REPORT_HOSTS.map(h => `MAP ${h} 127.0.0.1`).join(',')}`, 'about:blank'
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
    return probe();
  };
  const probe = async () => {
    const r = await c.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    return JSON.parse(r.result.value);
  };
  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  // sam proc.kill() zabija tylko proces startowy — procesy potomne trzymałyby port dla kolejnej przeglądarki
  const close = async () => {
    try { await Promise.race([c.send('Browser.close'), sleep(3000)]); } catch {}
    try { ws.close(); } catch {}
    proc.kill();
    for (let i = 0; i < 20 && await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false); i++) await sleep(500);
  };
  return { run, probe, clickAt, loaded: !!sw, close };
}

const profile = mkdtempSync(join(tmpdir(), 'ccr-e2e-'));
const reportData = mkdtempSync(join(tmpdir(), 'ccr-e2e-srv-'));
const reportSrv = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '18080', HOST: '127.0.0.1', DATA_DIR: reportData, CHECK_DNS: '0', POW_BITS: '20', TRUSTED_PROXIES: '' }
});
let srvLog = '';
reportSrv.stdout.on('data', d => { srvLog += d; });
reportSrv.stderr.on('data', d => { srvLog += d; });
const until = async (pred, ms) => { const t0 = Date.now(); let r; do { r = await browser.probe(); if (pred(r)) break; await sleep(250); } while (Date.now() - t0 < ms); return { ...r, waited: Date.now() - t0 }; };
const pendingFile = key => join(reportData, 'pending', `${key}.json`);

// położenie przycisków karty zgłoszenia (prawy dolny róg, szer. 360 px — patrz .report w src/ui.js)
const reportBtn = (r, which) => ({ x: r.vw - (which === 'yes' ? 112 : 280), y: r.vh - 50 });

let browser;
let failed = 0;
const check = (name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} ${JSON.stringify(info)}`); };
try {
  browser = kind === 'firefox' ? await runFirefox(profile) : await runChromium(profile);
  if (browser.loaded === false) throw new Error('rozszerzenie się nie załadowało');
  await browser.run(`${BASE}?ext=1&case=none`, 2000); // rozgrzewka (start tła rozszerzenia)
  for (const [name, check, wait] of CASES) {
    const r = await browser.run(`${BASE}?ext=1&case=${name}`, wait);
    const ok = check(r);
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} ${JSON.stringify(r)}`);
    if (r.report) { failed++; console.log('FAIL         ^ niepotrzebna propozycja zgłoszenia'); }
  }

  // --- zgłoszenie: nierozpoznane przyciski → propozycja → „Zgłoś” → serwer zapisuje zgłoszenie ---
  {
    await browser.run(onHost(REPORT_HOSTS[0], `${BASE}?ext=1&case=unrecognized`), 0);
    const r = await until(x => x.report, 20000);
    check('report-offer', r.report && !r.clicked, r);
    const btn = reportBtn(r, 'yes');
    const t0 = Date.now();
    await browser.clickAt(btn.x, btn.y);
    let sent = false;
    while (!sent && Date.now() - t0 < 30000) { await sleep(250); sent = existsSync(pendingFile('example.com')); }
    const after = await browser.probe();
    check('report-send', sent && !after.report && !after.clicked, { sent, ms: Date.now() - t0, toast: after.toast });
  }

  // --- „Odrzuć” nie działa → bez akceptacji na ślepo, propozycja → „Nie” → nic nie wysłane ---
  {
    await browser.run(onHost(REPORT_HOSTS[1], `${BASE}?ext=1&case=stuck`), 0);
    const r = await until(x => x.report, 20000);
    check('stuck-offer', r.report && !r.clicked && r.rejectTried >= 1, r);
    const btn = reportBtn(r, 'no');
    await browser.clickAt(btn.x, btn.y);
    await sleep(2500);
    const after = await browser.probe();
    check('stuck-decline', !after.report && !after.clicked && !existsSync(pendingFile('example.org')), after);
  }

  // --- obsługa trwa za długo → przerwanie (bez dalszych kliknięć) i propozycja zgłoszenia ---
  {
    await browser.run(onHost(REPORT_HOSTS[2], `${BASE}?ext=1&case=slow`), 0);
    const r = await until(x => x.report, 45000);
    await sleep(3000);
    const later = await browser.probe();
    check('slow-offer', r.report && !r.clicked && r.waited < 32000 && r.toggleClicks < 600 && later.toggleClicks === r.toggleClicks,
      { waited: r.waited, toggleClicks: r.toggleClicks, later: later.toggleClicks, clicked: r.clicked });
  }

  // --- „Odrzuć” pozornie działa, okienko wraca → propozycja zgłoszenia ---
  {
    await browser.run(onHost(REPORT_HOSTS[3], `${BASE}?ext=1&case=reappear`), 0);
    const r = await until(x => x.report, 20000);
    check('reappear', r.report && !r.clicked && r.rejectTried === 1, { waited: r.waited, rejectTried: r.rejectTried, clicked: r.clicked });
  }
} catch (e) {
  failed++;
  console.error('BŁĄD:', e.message);
} finally {
  if (browser) await browser.close();
  reportSrv.kill();
  await sleep(1500);
  if (failed) console.log('\nlog serwera zgłoszeń:\n' + srvLog);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  try { rmSync(reportData, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} nieudanych` : '\nwszystkie scenariusze OK');
process.exit(failed ? 1 : 0);
