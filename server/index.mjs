// Serwer zgłoszeń nieobsługiwanych okienek cookie.
// Wtyczka wysyła zgłoszenie → serwer sprawdza je i ogranicza spam → tworzy PR na GitHubie (jako GitHub App).
// Bez zależności — wymaga Node 22+.
//
// Zabezpieczenia:
//  - przyjmuje połączenia tylko od zaufanego proxy (Cloudflare/mikrus) — bezpośredni dostęp jest zrywany,
//  - proof-of-work: każde zgłoszenie kosztuje klienta ~1–3 s obliczeń, serwer sprawdza je jednym haszem,
//  - limity: na adres IP (IPv6 liczone jako /64), na domenę (jeden PR na domenę), dzienny limit PR-ów,
//    limit otwartych PR-ów ze zgłoszeniami, limit kolejki i połączeń, limit rozmiaru i czasu zapytania,
//  - domena ze zgłoszenia musi istnieć w DNS, treść jest walidowana i przycinana,
//  - token GitHuba istnieje tylko na serwerze; aplikacja ma prawo pisać wyłącznie do gałęzi innych niż main.
import http from 'node:http';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
export const CFG = {
  port: +env.PORT || 8080,
  host: env.HOST || '::',
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  dataDir: env.DATA_DIR || './data',
  owner: env.GH_OWNER || 'archdev-arciszewski',
  repo: env.GH_REPO || 'cookie-rejector',
  base: env.GH_BASE || 'main',
  api: (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, ''),
  web: (env.GITHUB_WEB || 'https://github.com').replace(/\/$/, ''),
  appName: env.GH_APP_NAME || 'cookie-rejector-reports',
  setupToken: env.SETUP_TOKEN || '',
  // prefiksy adresów zaufanego proxy; puste = tryb deweloperski (ufa wszystkim, IP z gniazda)
  trusted: (env.TRUSTED_PROXIES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  powBits: +env.POW_BITS || 20,
  ipPer10m: +env.IP_PER_10M || 4,
  ipPerDay: +env.IP_PER_DAY || 12,
  prPerDay: +env.PR_PER_DAY || 25,
  maxOpenPrs: +env.MAX_OPEN_PRS || 40,
  maxQueue: +env.MAX_QUEUE || 20,
  checkDns: env.CHECK_DNS !== '0',
  maxBody: 48 * 1024
};

const REASONS = ['reject-failed', 'no-accept', 'unrecognized', 'manual'];
const BTN_CLASSES = ['reject', 'save', 'settings', 'accept', 'pay', 'close'];
const CATS = ['necessary', 'functional', 'analytics', 'marketing', 'personalization', 'social', 'thirdParty', 'legitimateInterest', 'other'];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sha256 = s => crypto.createHash('sha256').update(s).digest();
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');

// ======================================================================
// Domeny
// ======================================================================
const MULTI_TLD = new Set(('co.uk org.uk ac.uk gov.uk me.uk com.pl net.pl org.pl edu.pl gov.pl info.pl biz.pl waw.pl ' +
  'com.au net.au org.au co.jp ne.jp co.nz com.br com.tr co.in co.za com.mx com.ar com.cn com.ua co.kr co.il ' +
  'com.sg com.hk com.tw co.at or.at com.es com.pt com.gr com.ro co.id com.my com.ph com.vn').split(' '));

export function baseDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\d*\./, '');
  const p = h.split('.');
  if (p.length <= 2) return h;
  return MULTI_TLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

export function validHost(h) {
  if (typeof h !== 'string' || h.length > 253 || !h.includes('.')) return false;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false; // bez adresów IP
  if (/(^|\.)(localhost|local|internal|test|example|invalid|lan|home|corp)$/.test(h)) return false;
  return h.split('.').every(l => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) && /[a-z]/.test(h.split('.').pop());
}

async function hostExists(h) {
  if (!CFG.checkDns) return true;
  const t = new Promise(r => setTimeout(() => r(false), 3000));
  const q = Promise.any([dns.resolve4(h), dns.resolve6(h)]).then(a => a.length > 0, () => false);
  return Promise.race([q, t]);
}

// ======================================================================
// Walidacja zgłoszenia (przyjmujemy tylko znane pola, wszystko przycięte)
// ======================================================================
const str = (v, n) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, n) : '';
const bool = v => v === true;

export function sanitize(r) {
  if (!r || typeof r !== 'object' || r.v !== 1) return null;
  const page = r.page || {};
  const host = str(page.host, 253).toLowerCase();
  if (!validHost(host)) return null;
  const frameHost = str(page.frameHost, 253).toLowerCase();
  const reason = REASONS.includes(r.reason) ? r.reason : null;
  if (!reason) return null;
  return {
    v: 1,
    ext: str(r.ext, 20).replace(/[^0-9.]/g, ''),
    browser: str(r.browser, 40).replace(/[^\w .()/-]/g, ''),
    reason,
    cmp: str(r.cmp, 40).replace(/[^\w .-]/g, ''),
    page: {
      host,
      path: str(page.path, 300).replace(/[?#].*$/, ''),
      frameHost: validHost(frameHost) ? frameHost : '',
      lang: str(page.lang, 20).replace(/[^\w-]/g, ''),
      top: page.top !== false
    },
    blocking: bool(r.blocking),
    text: str(r.text, 5000),
    buttons: (Array.isArray(r.buttons) ? r.buttons : []).slice(0, 40).map(b => ({
      t: str(b && b.t, 100), c: BTN_CLASSES.includes(b && b.c) ? b.c : null
    })).filter(b => b.t),
    toggles: (Array.isArray(r.toggles) ? r.toggles : []).slice(0, 60).map(t => ({
      t: str(t && t.t, 100), on: bool(t && t.on), dis: bool(t && t.dis), cat: CATS.includes(t && t.cat) ? t.cat : null
    })),
    outline: str(r.outline, 6000)
  };
}

// ======================================================================
// Markdown
// ======================================================================
const fence = (s, lang = 'text') => {
  const runs = (String(s).match(/`+/g) || []).map(x => x.length);
  const f = '`'.repeat(Math.max(3, ...runs.map(n => n + 1)));
  return `${f}${lang}\n${s}\n${f}`;
};
const cell = s => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, "'").replace(/([*_[\]])/g, '\\$1');

export const REASON_PL = {
  'reject-failed': 'Okienko ma opcję odrzucenia lub ustawień, ale jej użycie nie zamknęło okienka',
  'no-accept': 'Okienko ma przyciski, ale żaden nie pozwala zamknąć go zgodnie z ustawieniami',
  unrecognized: 'Okienko cookie wykryte, ale żaden przycisk nie został rozpoznany',
  manual: 'Zgłoszenie ręczne (użytkownik wskazał stronę z okienkiem, którego wtyczka nie obsłużyła)'
};

export function renderMd(rep, key, date) {
  const p = rep.page;
  const lines = [
    '---',
    `domain: ${key}`,
    `host: ${p.host}`,
    `url: https://${p.host}${p.path || '/'}`,
    p.frameHost && p.frameHost !== p.host ? `frame: ${p.frameHost}` : null,
    `reported: ${date}`,
    `reason: ${rep.reason}`,
    `cmp: ${rep.cmp || '-'}`,
    `extension: ${rep.ext || '-'}`,
    `browser: ${rep.browser || '-'}`,
    'status: nowe',
    '---',
    '',
    `# ${key}`,
    '',
    `> Zgłoszenie automatyczne z wtyczki Cookie Rejector. Treść pochodzi od użytkownika — nie otwieraj linków bez sprawdzenia.`,
    '',
    `**Problem:** ${REASON_PL[rep.reason]}.`,
    '',
    '| | |', '|---|---|',
    `| Strona | ${cell(`https://${p.host}${p.path || '/'}`)} |`,
    p.frameHost && p.frameHost !== p.host ? `| Ramka (iframe) | ${cell(p.frameHost)} |` : null,
    `| Rozpoznany CMP | ${cell(rep.cmp || 'brak (heurystyka)')} |`,
    `| Blokuje stronę | ${rep.blocking ? 'tak' : 'nie'} |`,
    `| Język strony | ${cell(p.lang || '-')} |`,
    `| Wtyczka / przeglądarka | ${cell(rep.ext || '-')} / ${cell(rep.browser || '-')} |`,
    '',
    '## Przyciski',
    '',
    rep.buttons.length
      ? ['| Tekst | Rozpoznany jako |', '|---|---|', ...rep.buttons.map(b => `| ${cell(b.t)} | ${b.c || '—'} |`)].join('\n')
      : '_Brak przycisków._',
    '',
    '## Przełączniki',
    '',
    rep.toggles.length
      ? ['| Etykieta | Kategoria | Stan |', '|---|---|---|', ...rep.toggles.map(t =>
        `| ${cell(t.t || '(bez etykiety)')} | ${t.cat || '—'} | ${t.on ? 'wł.' : 'wył.'}${t.dis ? ' (zablokowany)' : ''} |`)].join('\n')
      : '_Brak przełączników._',
    '',
    '## Tekst okienka',
    '',
    fence(rep.text || '(pusty)'),
    '',
    '## Struktura okienka (skrót)',
    '',
    fence(rep.outline || '(brak)'),
    ''
  ];
  return lines.filter(l => l !== null).join('\n');
}

// ======================================================================
// Stan (plik JSON) i limity
// ======================================================================
const statePath = () => path.join(CFG.dataDir, 'state.json');
let state = null;
function loadState() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { state = {}; }
  state.keys ||= {};
  state.daily ||= { date: '', prs: 0 };
  return state;
}
function saveState() {
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const tmp = statePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, statePath());
}

class Limiter {
  constructor() { this.m = new Map(); }
  _list(k) { const now = Date.now(); const l = (this.m.get(k) || []).filter(t => now - t < 864e5); this.m.set(k, l); return l; }
  allowed(k) {
    const l = this._list(k); const now = Date.now();
    return l.length < CFG.ipPerDay && l.filter(t => now - t < 6e5).length < CFG.ipPer10m;
  }
  hit(k) { this._list(k).push(Date.now()); }
  sweep() { for (const k of this.m.keys()) if (!this._list(k).length) this.m.delete(k); }
}
const limiter = new Limiter();
const seenBodies = new Map(); // hash treści → czas (blokada powtórek)
const active = new Map();     // IP → liczba trwających zapytań
setInterval(() => {
  limiter.sweep();
  const now = Date.now();
  for (const [k, t] of seenBodies) if (now - t > 15 * 6e4) seenBodies.delete(k);
}, 6e4).unref();

export function ipKey(ip) {
  ip = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  if (!ip.includes(':')) return ip;
  const [a, b = ''] = ip.split('::');
  const head = a ? a.split(':') : [], tail = b ? b.split(':') : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// ======================================================================
// Proof-of-work
// ======================================================================
function leadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}
export function checkPow(ts, nonce, bits, body) {
  return leadingZeroBits(sha256(`${sha256hex(body)}:${ts}:${nonce}`)) >= bits;
}

// ======================================================================
// GitHub App
// ======================================================================
const appPath = () => path.join(CFG.dataDir, 'app.json');
const pemPath = () => path.join(CFG.dataDir, 'app.pem');
function loadApp() {
  try { return { ...JSON.parse(fs.readFileSync(appPath(), 'utf8')), pem: fs.readFileSync(pemPath(), 'utf8') }; } catch { return null; }
}
const configured = () => !!loadApp();

let tokenCache = null;
function appJwt(app) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: String(app.appId) })}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), app.pem).toString('base64url')}`;
}

async function gh(method, url, body, auth) {
  const res = await fetch(url.startsWith('http') ? url : CFG.api + url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cookie-rejector-reports',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function installationToken() {
  if (tokenCache && tokenCache.exp - Date.now() > 5 * 6e4) return tokenCache.token;
  const app = loadApp();
  if (!app) throw new Error('GitHub App nie jest skonfigurowana');
  const jwt = appJwt(app);
  if (!app.installationId) {
    const r = await gh('GET', `/repos/${CFG.owner}/${CFG.repo}/installation`, null, jwt);
    if (r.status !== 200) throw new Error(`aplikacja nie jest zainstalowana w repozytorium (${r.status})`);
    app.installationId = r.data.id;
    const { pem, ...rest } = app;
    fs.writeFileSync(appPath(), JSON.stringify(rest, null, 1));
  }
  const r = await gh('POST', `/app/installations/${app.installationId}/access_tokens`,
    { repositories: [CFG.repo], permissions: { contents: 'write', pull_requests: 'write' } }, jwt);
  if (r.status !== 201) throw new Error(`nie udało się pobrać tokenu (${r.status})`);
  tokenCache = { token: r.data.token, exp: Date.parse(r.data.expires_at) };
  return tokenCache.token;
}

const today = () => new Date().toISOString().slice(0, 10);

async function submit(rep) {
  const key = baseDomain(rep.page.host);
  const st = loadState();
  const known = st.keys[key];
  if (known) { known.count = (known.count || 1) + 1; known.last = today(); saveState(); return { status: 'known', url: known.url }; }

  if (!configured()) {
    fs.mkdirSync(path.join(CFG.dataDir, 'pending'), { recursive: true });
    fs.writeFileSync(path.join(CFG.dataDir, 'pending', `${key}.json`), JSON.stringify(rep));
    st.keys[key] = { url: null, first: today(), count: 1, pending: true };
    saveState();
    return { status: 'stored' };
  }
  return createPr(rep, key);
}

async function createPr(rep, key) {
  const st = loadState();
  if (st.daily.date !== today()) st.daily = { date: today(), prs: 0 };
  if (st.daily.prs >= CFG.prPerDay) return { status: 'limited' };

  const tok = await installationToken();
  const R = `/repos/${CFG.owner}/${CFG.repo}`;
  const file = `unsupported/${key}.md`;
  const mark = url => { st.keys[key] = { url, first: today(), count: 1 }; saveState(); return { status: 'known', url }; };

  const inBase = await gh('GET', `${R}/contents/${file}?ref=${CFG.base}`, null, tok);
  if (inBase.status === 200) return mark(inBase.data.html_url);

  const prs = await gh('GET', `${R}/pulls?state=open&per_page=100`, null, tok);
  if (prs.status !== 200) throw new Error(`lista PR (${prs.status})`);
  const reportPrs = prs.data.filter(p => p.head && p.head.ref.startsWith('report/'));
  const existing = reportPrs.find(p => p.head.ref === `report/${key}`);
  if (existing) return mark(existing.html_url);
  if (reportPrs.length >= CFG.maxOpenPrs) return { status: 'limited' };

  const ref = await gh('GET', `${R}/git/ref/heads/${CFG.base}`, null, tok);
  if (ref.status !== 200) throw new Error(`ref ${CFG.base} (${ref.status})`);
  const branch = `report/${key}`;
  const mk = await gh('POST', `${R}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.data.object.sha }, tok);
  if (mk.status === 422) return mark(`${CFG.web}/${CFG.owner}/${CFG.repo}/tree/${branch}`);
  if (mk.status !== 201) throw new Error(`gałąź (${mk.status})`);

  const md = renderMd(rep, key, today());
  const put = await gh('PUT', `${R}/contents/${file}`, {
    message: `Zgłoszenie nieobsługiwanego okienka: ${key}`,
    content: Buffer.from(md).toString('base64'),
    branch
  }, tok);
  if (put.status !== 201) throw new Error(`plik (${put.status})`);

  const pr = await gh('POST', `${R}/pulls`, {
    title: `Nieobsługiwane okienko: ${key}`,
    head: branch,
    base: CFG.base,
    maintainer_can_modify: true,
    body: [
      `Automatyczne zgłoszenie z wtyczki: **${REASON_PL[rep.reason]}**.`,
      '',
      `- Domena: \`${key}\``,
      `- CMP: ${rep.cmp ? `\`${rep.cmp}\`` : 'nierozpoznany'}`,
      `- Szczegóły: [\`${file}\`](../blob/${branch}/${file})`,
      '',
      'Merge dopisuje przypadek do listy [UNSUPPORTED.md](../blob/main/UNSUPPORTED.md) (lista odświeża się automatycznie).',
      'Gdy obsługa zostanie dodana, usuń plik zgłoszenia w PR z poprawką.'
    ].join('\n')
  }, tok);
  if (pr.status !== 201) throw new Error(`PR (${pr.status})`);
  st.daily.prs++;
  log('utworzono PR', pr.data.html_url);
  return { ...mark(pr.data.html_url), status: 'created' };
}

/** Po konfiguracji aplikacji wysyła zgłoszenia zebrane wcześniej. */
async function flushPending() {
  const dir = path.join(CFG.dataDir, 'pending');
  if (!configured() || !fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const key = f.replace(/\.json$/, '');
    try {
      const rep = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const st = loadState();
      delete st.keys[key];
      const r = await queue(() => createPr(rep, key));
      if (r.status === 'limited') { st.keys[key] = { url: null, first: today(), count: 1, pending: true }; saveState(); break; }
      fs.unlinkSync(path.join(dir, f));
    } catch (e) { log('pending', key, e.message); break; }
  }
}

// kolejka: zgłoszenia przetwarzane po jednym (bez wyścigów o tę samą domenę)
let chain = Promise.resolve();
let queued = 0;
function queue(fn) {
  if (queued >= CFG.maxQueue) return Promise.resolve({ status: 'busy' });
  queued++;
  const p = chain.then(fn).finally(() => { queued--; });
  chain = p.catch(() => {});
  return p;
}

// ======================================================================
// HTTP
// ======================================================================
const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const b = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(b), Connection: 'close', ...extra });
  res.end(b);
}
const html = (res, code, title, inner) => send(res, code,
  `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">${inner}</body></html>`,
  'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com " + CFG.web });
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function trustedPeer(addr) {
  if (!CFG.trusted.length) return true;
  const a = String(addr || '').toLowerCase();
  return CFG.trusted.some(p => a.startsWith(p));
}

function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  if (!CFG.trusted.length) return peer;
  const ip = String(req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || '').trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : peer;
}

async function handleReport(req, res, ip) {
  const k = ipKey(ip);
  if (!limiter.allowed(k)) return send(res, 429, { status: 'rate-limited' }, undefined, { 'Retry-After': '3600' });
  let raw;
  try { raw = await readBody(req, CFG.maxBody); } catch (e) { return send(res, e.code || 400, { status: 'bad-request' }); }

  const nl = raw.indexOf('\n');
  const m = /^ccr1 (\d{13}) (\d{1,12}) (\d{1,2})$/.exec(nl > 0 ? raw.slice(0, nl) : '');
  if (!m) { limiter.hit(k); return send(res, 400, { status: 'bad-request' }); }
  const [, ts, nonce, bitsS] = m;
  const bits = +bitsS;
  const body = raw.slice(nl + 1);
  if (bits < CFG.powBits) return send(res, 428, { status: 'pow', powBits: CFG.powBits });
  if (Math.abs(Date.now() - +ts) > 10 * 6e4) return send(res, 400, { status: 'clock' });
  const bh = sha256hex(body);
  if (seenBodies.has(bh)) return send(res, 409, { status: 'duplicate' });
  if (!checkPow(ts, nonce, bits, body)) { limiter.hit(k); return send(res, 400, { status: 'pow-invalid' }); }
  seenBodies.set(bh, Date.now());
  limiter.hit(k);

  let rep;
  try { rep = sanitize(JSON.parse(body)); } catch { rep = null; }
  if (!rep) return send(res, 422, { status: 'invalid' });
  if (!(await hostExists(rep.page.host))) return send(res, 422, { status: 'invalid-host' });

  try {
    const r = await queue(() => submit(rep));
    log('zgłoszenie', baseDomain(rep.page.host), rep.reason, r.status);
    return send(res, r.status === 'busy' ? 503 : 200, r);
  } catch (e) {
    log('błąd', e.message);
    return send(res, 502, { status: 'error' });
  }
}

function setupPage(res, q) {
  if (!CFG.setupToken || q.get('token') !== CFG.setupToken || configured()) return send(res, 404, { status: 'not-found' });
  const manifest = {
    name: CFG.appName,
    url: `${CFG.web}/${CFG.owner}/${CFG.repo}`,
    description: 'Tworzy PR-y ze zgłoszeniami nieobsługiwanych okienek cookie z wtyczki Cookie Rejector.',
    redirect_url: `${CFG.publicUrl}/setup/callback`,
    hook_attributes: { url: `${CFG.publicUrl}/hook`, active: false },
    public: false,
    default_permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
    default_events: []
  };
  return html(res, 200, 'Konfiguracja', `<h1>Cookie Rejector — serwer zgłoszeń</h1>
    <p>Krok 1: utwórz GitHub App dla tego serwera. Klucz prywatny trafi bezpośrednio na serwer — nie zobaczysz go i nie musisz nic kopiować.</p>
    <form method="post" action="${escHtml(CFG.web)}/settings/apps/new?state=${encodeURIComponent(CFG.setupToken)}">
    <input type="hidden" name="manifest" value="${escHtml(JSON.stringify(manifest))}">
    <button style="font-size:18px;padding:10px 18px">Utwórz GitHub App</button></form>`);
}

async function setupCallback(res, q) {
  if (!CFG.setupToken || q.get('state') !== CFG.setupToken || configured()) return send(res, 404, { status: 'not-found' });
  const code = q.get('code') || '';
  if (!/^[\w-]{1,100}$/.test(code)) return send(res, 400, { status: 'bad-request' });
  const r = await gh('POST', `/app-manifests/${code}/conversions`);
  if (r.status !== 201 || !r.data || !r.data.pem) return html(res, 502, 'Błąd', `<p>GitHub odrzucił konfigurację (${r.status}). Spróbuj ponownie od początku.</p>`);
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  fs.writeFileSync(pemPath(), r.data.pem, { mode: 0o600 });
  fs.writeFileSync(appPath(), JSON.stringify({ appId: r.data.id, slug: r.data.slug, created: new Date().toISOString() }, null, 1), { mode: 0o600 });
  log('utworzono GitHub App', r.data.slug);
  const install = `${CFG.web}/apps/${encodeURIComponent(r.data.slug)}/installations/new`;
  return html(res, 200, 'Gotowe', `<h1>Aplikacja utworzona ✓</h1>
    <p>Krok 2: zainstaluj ją <b>tylko</b> w repozytorium <code>${escHtml(CFG.owner)}/${escHtml(CFG.repo)}</code>
    (opcja „Only select repositories”).</p>
    <p><a href="${escHtml(install)}" style="font-size:18px">Zainstaluj aplikację →</a></p>`);
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    const peer = req.socket.remoteAddress;
    if (!trustedPeer(peer)) { req.socket.destroy(); return; }
    const ip = clientIp(req);
    const n = active.get(ip) || 0;
    if (n >= 3) return send(res, 429, { status: 'rate-limited' });
    active.set(ip, n + 1);
    try {
      const u = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' });
      if (req.method === 'POST' && u.pathname === '/v1/report') return await handleReport(req, res, ip);
      if (req.method === 'GET' && u.pathname === '/health') return send(res, 200, { ok: true, configured: configured(), powBits: CFG.powBits });
      if (req.method === 'GET' && u.pathname === '/setup') return setupPage(res, u.searchParams);
      if (req.method === 'GET' && u.pathname === '/setup/callback') return await setupCallback(res, u.searchParams);
      return send(res, 404, { status: 'not-found' });
    } catch (e) {
      log('błąd obsługi', e.message);
      if (!res.headersSent) send(res, 500, { status: 'error' });
    } finally {
      const c = (active.get(ip) || 1) - 1;
      if (c) active.set(ip, c); else active.delete(ip);
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 50;
  server.maxConnections = 200;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.mjs')) {
  const server = createServer();
  server.listen(CFG.port, CFG.host, () => {
    log(`nasłuch na [${CFG.host}]:${CFG.port}, PoW ${CFG.powBits} bitów, proxy: ${CFG.trusted.join(',') || 'dowolne (dev)'}, aplikacja: ${configured() ? 'tak' : 'nie'}`);
  });
  setInterval(() => flushPending().catch(e => log('pending', e.message)), 5 * 6e4).unref();
  setTimeout(() => flushPending().catch(() => {}), 5000).unref();
}
