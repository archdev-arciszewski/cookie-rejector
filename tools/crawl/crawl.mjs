// Crawl stron z rozszerzeniem Cookie Rejector (Playwright, Chromium headless, tymczasowy profil).
// node crawl.mjs --sites sites.json --out runDir [--ext <bezwzględna ścieżka>] [--baseline] [--conc 3] [--wait 14000] [--only re]
// Wynik: runDir/results.jsonl (jedna linia na stronę) + runDir/shots/<n>.jpg
// Na stronach nic nie klikamy i niczego nie wpisujemy — działa tylko rozszerzenie (albo nic, w trybie --baseline).
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Playwright nie jest zależnością repozytorium: CCR_PLAYWRIGHT = katalog projektu z node_modules/playwright
// (np. dowolny projekt z `npm i -D playwright`), domyślnie bieżący katalog.
const require = createRequire(join(process.env.CCR_PLAYWRIGHT || process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const sites = JSON.parse(readFileSync(args.sites, 'utf8')).filter(s => !args.only || new RegExp(args.only).test(s.url));
const out = args.out; mkdirSync(join(out, 'shots'), { recursive: true });
const resFile = join(out, 'results.jsonl');
const done = new Set(existsSync(resFile) ? readFileSync(resFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).url) : []);
const conc = +(args.conc || 3), wait = +(args.wait || 14000);
const baseline = !!args.baseline;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms, dflt = null) => Promise.race([Promise.resolve(p).catch(() => dflt), sleep(ms).then(() => dflt)]);

// Niezależny detektor okienka zgody na ekranie (główny świat strony, bez wiedzy o silniku wtyczki).
const RESIDUAL = () => {
  const RE = /cookie|ciastecz|ciasteczk|\brodo\b|gdpr|rgpd|dsgvo|consent|zgod[ayęe]|datenschutz|einwillig|consentement|privacidad|privacy|prywatno|tracking|tracker|partner/i;
  const STRONG = /cookie|ciastecz|ciasteczk|\brodo\b|gdpr|rgpd|dsgvo|consent|einwillig|consentement|tcf|tracker|tracking/i;
  const CMP_FRAME = /consent|cmp|privacy-mgmt|sourcepoint|cookie|gdpr|didomi|usercentrics|onetrust|trustarc|consensu|quantcast|inmobi|fundingchoices|sp_message|truste|privacy-center|iubenda|axept/i;
  const vw = innerWidth, vh = innerHeight;
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
    return el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true; };
  const deepText = el => { let t = el.innerText || ''; if (el.shadowRoot) t += ' ' + [...el.shadowRoot.querySelectorAll('*')].filter(e => !/^(STYLE|SCRIPT)$/.test(e.tagName) && e.children.length === 0).map(e => e.textContent).join(' '); return t; };
  const out = [];
  // wszystkie elementy łącznie z otwartymi Shadow DOM (Usercentrics, consentmanager, Ketch…)
  const all = [];
  const walk = root => { for (const el of root.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  if (document.body) walk(document.body);
  const up = n => n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode;
  const containsDeep = (a, b) => { for (let n = up(b); n; n = up(n)) if (n === a) return true; return false; };
  const floats = [];
  for (const el of all) {
    if (el.id && el.id.startsWith('ccr-')) continue;
    const cs = getComputedStyle(el);
    const fl = cs.position === 'fixed' || cs.position === 'sticky' || el.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]');
    if (fl) floats.push(el);
  }
  const fset = new Set(floats);
  const roots = floats.filter(el => { for (let n = up(el); n; n = up(n)) if (fset.has(n)) return false; return true; });
  void containsDeep;
  for (const el of roots) {
    if (!vis(el) && !el.shadowRoot) continue;
    const r = el.getBoundingClientRect();
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / (vw * vh);
    const t = deepText(el).replace(/\s+/g, ' ').trim();
    if (!t || !STRONG.test(t)) continue;
    if (area < 0.01 && !el.shadowRoot) continue;
    const bl = (el.shadowRoot ? [...el.shadowRoot.querySelectorAll('button,[role=button],a')] : [...el.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')]);
    const labels = bl.filter(vis).map(b => ((b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).slice(0, 40) + '<' + b.tagName.toLowerCase() + (b.id ? '#' + b.id : '') + (typeof b.className === 'string' && b.className ? '.' + b.className.trim().split(/\s+/)[0] : '') + '>').slice(0, 14);
    out.push({ tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
      area: +area.toFixed(3), btns: bl.length, labels, text: t.slice(0, 300) });
  }
  const frames = [...document.querySelectorAll('iframe')].filter(f => CMP_FRAME.test((f.src || '') + ' ' + f.id + ' ' + f.name + ' ' + f.title) && vis(f)).map(f => {
    const r = f.getBoundingClientRect(); return { src: (f.src || '').slice(0, 120), id: f.id, area: +(r.width * r.height / (vw * vh)).toFixed(3) };
  }).filter(f => f.area > 0.02);
  const concealed = [...document.querySelectorAll('[style*="clip-path"]')].filter(e => /clip-path:\s*inset\(50%\)\s*!important/.test(e.getAttribute('style') || '')).length;
  const sh = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const locked = sh > vh + 40 && [document.documentElement, document.body].some(e => e && getComputedStyle(e).overflowY === 'hidden');
  return { dialogs: out.slice(0, 6), frames, concealed, locked, ours: { report: !!document.getElementById('ccr-report'), prompt: !!document.getElementById('ccr-wall-prompt'), toast: !!document.getElementById('ccr-toast') },
    title: document.title.slice(0, 120), textLen: (document.body && document.body.innerText || '').length };
};

const TCF = () => new Promise(res => {
  if (typeof window.__tcfapi !== 'function') return res(null);
  const t = setTimeout(() => res({ timeout: true }), 3000);
  try {
    window.__tcfapi('getTCData', 2, (d, ok) => {
      clearTimeout(t);
      if (!ok || !d) return res({ ok: false });
      const on = o => Object.entries(o || {}).filter(([, v]) => v).map(([k]) => +k);
      res({ cmpId: d.cmpId, gdprApplies: d.gdprApplies, eventStatus: d.eventStatus, cmpStatus: d.cmpStatus,
        purposeConsents: on(d.purpose && d.purpose.consents), purposeLI: on(d.purpose && d.purpose.legitimateInterests),
        vendorConsents: on(d.vendor && d.vendor.consents).length, vendorLI: on(d.vendor && d.vendor.legitimateInterests).length,
        specialFeatures: on(d.specialFeatureOptins) });
    });
  } catch (e) { clearTimeout(t); res({ error: String(e) }); }
});

const BLOCK_RE = /access denied|attention required|just a moment|are you a robot|captcha|verify you are human|403 forbidden|request blocked|you have been blocked|pardon our interruption|bot detection/i;

async function visit(ctx, site, idx) {
  // twardy limit na stronę: zawieszona strona/ramka nie może zatrzymać partii
  let page;
  const work = visitInner(ctx, site, idx, p => { page = p; });
  const res = await within(work, 90000, null);
  if (res) return res;
  if (page) page.close().catch(() => {});
  return { url: site.url, country: site.country, category: site.category, expectedCmp: site.expectedCmp, mode: baseline ? 'baseline' : 'ext', error: 'hang (90 s)' };
}

async function visitInner(ctx, site, idx, setPage) {
  const page = await ctx.newPage();
  setPage(page);
  const r = { url: site.url, country: site.country, category: site.category, expectedCmp: site.expectedCmp, mode: baseline ? 'baseline' : 'ext', t0: Date.now() };
  try {
    const resp = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    r.status = resp ? resp.status() : null;
    r.finalUrl = page.url();
    await sleep(wait);
    r.residual = await within(page.evaluate(RESIDUAL), 8000, { error: 'timeout' });
    r.tcf = await within(page.evaluate(TCF), 5000, null);
    r.cookies = ((await within(ctx.cookies(page.url()), 5000, [])) || []).map(c => c.name).filter(n => /consent|cookie|optanon|didomi|euconsent|cmplz|uc_|usercentrics|borlabs|cky|klaro|iubenda|axeptio|_sp_|gdpr|ccm|cmp|privacy|tarteaucitron|osano|termly|cookiefirst|CookieConsent|wcp|ckns|ccr/i.test(n)).slice(0, 25);
    if (!baseline) {
      const logs = [];
      for (const f of page.frames()) {
        const l = await within(f.evaluate(() => { try { return sessionStorage.ccrLog || ''; } catch { return ''; } }), 2500, '');
        if (l) logs.push({ frame: f === page.mainFrame() ? 'top' : f.url().slice(0, 100), log: l.split('\n').filter(Boolean).slice(-60) });
      }
      r.logs = logs;
    }
    r.blocked = BLOCK_RE.test((r.residual && r.residual.title) || '') || (r.status >= 400 && r.status !== 404);
    await page.screenshot({ path: join(out, 'shots', `${idx}${baseline ? 'b' : ''}.jpg`), type: 'jpeg', quality: 45, timeout: 10000 }).catch(() => {});
  } catch (e) {
    r.error = String(e.message || e).split('\n')[0].slice(0, 200);
  } finally {
    r.ms = Date.now() - r.t0;
    await page.close().catch(() => {});
  }
  return r;
}

async function newCtx() {
  const profile = mkdtempSync(join(tmpdir(), 'ccr-crawl-'));
  const a = ['--no-first-run', '--no-default-browser-check', '--lang=pl-PL'];
  // Chromium nie znajdzie rozszerzenia po ścieżce względnej (inny katalog roboczy) — zawsze bezwzględna
  if (!baseline) { const ext = resolve(args.ext); a.push(`--disable-extensions-except=${ext}`, `--load-extension=${ext}`); }
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: a, viewport: { width: 1280, height: 800 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  if (!baseline) { // poczekaj na tło rozszerzenia
    for (let i = 0; i < 20 && !ctx.serviceWorkers().length; i++) await sleep(250);
  }
  return { ctx, profile };
}

const queue = sites.map((s, i) => ({ s, i })).filter(x => !done.has(x.s.url));
console.log(`stron: ${sites.length}, do zrobienia: ${queue.length}, tryb: ${baseline ? 'baseline' : 'ext'}`);
// partie po 30 stron, każda na świeżym profilu (pamięć; zgody zapisane przez jedną domenę nie wpływają na kolejne partie)
for (let b = 0; b < queue.length; b += 30) {
  const batch = queue.slice(b, b + 30);
  const cur = await newCtx();
  const worker = async () => {
    while (batch.length) {
      const { s, i } = batch.shift();
      const r = await visit(cur.ctx, s, i).catch(e => ({ url: s.url, error: String(e) }));
      r.idx = i;
      appendFileSync(resFile, JSON.stringify(r) + '\n');
      const h = (r.logs || []).flatMap(x => x.log).find(l => / handled | nieobsłużone /.test(l)) || '';
      console.log(`${i} ${s.url.slice(0, 60)} ${r.error ? 'ERR ' + r.error.slice(0, 60) : ''} dlg=${(r.residual && r.residual.dialogs && r.residual.dialogs.length) || 0} ${h.slice(0, 80)}`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  await cur.ctx.close().catch(() => {});
  setTimeout(() => { try { rmSync(cur.profile, { recursive: true, force: true }); } catch {} }, 3000);
}
console.log('koniec');
process.exit(0);
