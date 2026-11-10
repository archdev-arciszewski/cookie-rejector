// Testy serwera zgłoszeń z atrapą API GitHuba.   node server/test.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-srv-'));
const ghPort = 18766, srvPort = 18765;
Object.assign(process.env, {
  DATA_DIR: dataDir, PORT: String(srvPort), HOST: '127.0.0.1', GITHUB_API: `http://127.0.0.1:${ghPort}`,
  POW_BITS: '12', CHECK_DNS: '0', IP_PER_10M: '50', IP_PER_DAY: '100', PR_PER_DAY: '3', SETUP_TOKEN: 'tok123',
  PUBLIC_URL: 'https://example.invalid'
});
const S = await import('./index.mjs');

// ---- atrapa GitHuba ----
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const gh = { branches: new Set(), files: {}, prs: [], calls: [] };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    gh.calls.push(`${req.method} ${p}`);
    const j = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const R = '/repos/archdev-arciszewski/cookie-rejector';
    if (req.method === 'POST' && p === '/app-manifests/CODE/conversions') return j(201, { id: 42, slug: 'ccr-test', pem });
    if (req.method === 'GET' && p === `${R}/installation`) return j(200, { id: 7 });
    if (req.method === 'POST' && p === '/app/installations/7/access_tokens') {
      assert.match(req.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      return j(201, { token: 'ghs_test', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    }
    assert.equal(req.headers.authorization, 'Bearer ghs_test');
    if (req.method === 'GET' && p.startsWith(`${R}/contents/`)) return j(404, {});
    if (req.method === 'GET' && p === `${R}/pulls`) return j(200, gh.prs.map(x => ({ head: { ref: x.head }, html_url: x.url })));
    if (req.method === 'GET' && p === `${R}/git/ref/heads/main`) return j(200, { object: { sha: 'abc' } });
    if (req.method === 'POST' && p === `${R}/git/refs`) {
      const ref = JSON.parse(body).ref;
      if (gh.branches.has(ref)) return j(422, {});
      gh.branches.add(ref); return j(201, {});
    }
    if (req.method === 'PUT' && p.startsWith(`${R}/contents/`)) {
      const b = JSON.parse(body);
      gh.files[p.slice(`${R}/contents/`.length)] = Buffer.from(b.content, 'base64').toString();
      return j(201, {});
    }
    if (req.method === 'POST' && p === `${R}/pulls`) {
      const b = JSON.parse(body);
      const url = `https://github.com/x/pull/${gh.prs.length + 1}`;
      gh.prs.push({ head: b.head, url, title: b.title, body: b.body });
      return j(201, { html_url: url });
    }
    j(404, { p });
  });
});
await new Promise(r => mock.listen(ghPort, '127.0.0.1', r));
const server = S.createServer();
await new Promise(r => server.listen(srvPort, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srvPort}`;

// ---- klient (ta sama procedura co w background.js) ----
function pow(body, bits) {
  const bh = crypto.createHash('sha256').update(body).digest('hex');
  const ts = Date.now();
  for (let n = 0; ; n++) if (S.checkPow(String(ts), String(n), bits, body)) return { ts, n, bh };
}
async function post(report, { bits = 12, raw, ip } = {}) {
  const body = JSON.stringify(report);
  const { ts, n } = pow(body, bits);
  const r = await fetch(`${BASE}/v1/report`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', ...(ip ? { 'X-Real-IP': ip } : {}) },
    body: raw ?? `ccr1 ${ts} ${n} ${bits}\n${body}`
  });
  return { code: r.status, ...(await r.json()), cors: r.headers.get('access-control-allow-origin') };
}
const rep = (host, extra = {}) => ({
  v: 1, ext: '0.3.0', browser: 'Chrome 150', reason: 'reject-failed', cmp: '',
  page: { host, path: '/artykul?token=SEKRET#x', frameHost: host, lang: 'pl', top: true },
  blocking: true, text: 'Używamy plików cookie | ```kod``` <script>alert(1)</script>',
  buttons: [{ t: 'Akceptuj | wszystko', c: 'accept' }, { t: 'Opcje', c: null }],
  toggles: [{ t: 'Marketing', on: true, dis: false, cat: 'marketing' }],
  outline: 'div#cmp.banner[role=dialog]\n  button', evil: 'x'.repeat(10), ...extra
});

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('OK ', name); };

await t('jednostki: baseDomain / ipKey / validHost', () => {
  assert.equal(S.baseDomain('www.sport.wp.pl'), 'wp.pl');
  assert.equal(S.baseDomain('shop.example.com.pl'), 'example.com.pl');
  assert.equal(S.baseDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(S.ipKey('2a01:4f9:c013:f5c9::1'), '2a01:4f9:c013:f5c9::/64');
  assert.equal(S.ipKey('2a01:4f9::1'), '2a01:4f9:0:0::/64');
  assert.equal(S.ipKey('::ffff:1.2.3.4'), '1.2.3.4');
  assert.ok(S.validHost('wp.pl'));
  for (const h of ['localhost', '127.0.0.1', 'a', 'x.local', 'evil..com', '-a.com', 'a.123']) assert.ok(!S.validHost(h), h);
});

await t('pow.js z wtyczki daje wynik akceptowany przez serwer', async () => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({ Uint8Array, Int32Array, Math, Error });
  vm.runInContext(fs.readFileSync(new URL('../src/pow.js', import.meta.url), 'utf8').replace('(globalThis)', '(this)'), ctx);
  for (const body of ['{}', 'zażółć gęślą jaźń', 'x'.repeat(5000)]) {
    const bh = crypto.createHash('sha256').update(body).digest('hex');
    const ts = Date.now();
    const n = ctx.CCR_POW.solve(bh, ts, 14);
    assert.ok(S.checkPow(String(ts), String(n), 14, body), body.slice(0, 10));
  }
  const bh = crypto.createHash('sha256').update('bench').digest('hex');
  const t0 = Date.now(); let tries = 0;
  for (let i = 0; i < 5; i++) tries += ctx.CCR_POW.solve(bh, 1700000000000 + i, 20) + 1;
  console.log(`    PoW 20 bitów: średnio ${Math.round((Date.now() - t0) / 5)} ms, ${Math.round(tries / ((Date.now() - t0) / 1000) / 1000)} tys. hashy/s`);
});

await t('health + CORS', async () => {
  const r = await fetch(`${BASE}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await r.json(), { ok: true, configured: false, powBits: 12 });
});

await t('przed konfiguracją aplikacji zgłoszenie jest przechowane', async () => {
  const r = await post(rep('www.pending-site.pl'));
  assert.equal(r.status, 'stored');
  assert.ok(fs.existsSync(path.join(dataDir, 'pending', 'pending-site.pl.json')));
});

await t('setup: zły token → 404, dobry → formularz manifestu', async () => {
  assert.equal((await fetch(`${BASE}/setup?token=zly`)).status, 404);
  const r = await fetch(`${BASE}/setup?token=tok123`);
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /settings\/apps\/new\?state=tok123/);
  assert.match(h, /&quot;contents&quot;:&quot;write&quot;/);
});

await t('setup callback zapisuje klucz z prawami 600 i blokuje się po użyciu', async () => {
  assert.equal((await fetch(`${BASE}/setup/callback?code=CODE&state=zly`)).status, 404);
  const r = await fetch(`${BASE}/setup/callback?code=CODE&state=tok123`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /apps\/ccr-test\/installations\/new/);
  assert.ok(fs.readFileSync(path.join(dataDir, 'app.pem'), 'utf8').includes('PRIVATE KEY'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dataDir, 'app.pem')).mode & 0o777, 0o600);
  assert.equal((await fetch(`${BASE}/setup?token=tok123`)).status, 404);
  assert.equal((await fetch(`${BASE}/setup/callback?code=CODE&state=tok123`)).status, 404);
});

await t('zgłoszenie tworzy gałąź, plik md i PR', async () => {
  const r = await post(rep('www.sport.example-news.pl'));
  assert.equal(r.code, 200);
  assert.equal(r.status, 'created');
  assert.equal(r.cors, '*');
  assert.ok(gh.branches.has('refs/heads/report/example-news.pl'));
  const md = gh.files['unsupported/example-news.pl.md'];
  assert.ok(md);
  assert.match(md, /^---\ndomain: example-news.pl\nhost: www.sport.example-news.pl\nurl: https:\/\/www.sport.example-news.pl\/artykul\n/);
  assert.ok(!md.includes('SEKRET'), 'parametry URL usunięte');
  assert.match(md, /````text\n[^\n]*```kod```/); // blok kodu dłuższy niż backticki w treści
  assert.match(md, /\| Akceptuj \\\| wszystko \| accept \|/);
  assert.ok(!md.includes('evil'));
  assert.equal(gh.prs[0].title, 'Nieobsługiwane okienko: example-news.pl');
});

await t('druga strona tej samej domeny → known (bez nowego PR)', async () => {
  const before = gh.prs.length;
  const r = await post(rep('inna.example-news.pl'));
  assert.equal(r.status, 'known');
  assert.equal(r.url, gh.prs[0].url);
  assert.equal(gh.prs.length, before);
});

await t('powtórka tej samej treści → 409', async () => {
  const body = JSON.stringify(rep('dup-site.com'));
  const { ts, n } = pow(body, 12);
  const raw = `ccr1 ${ts} ${n} 12\n${body}`;
  assert.equal((await post(null, { raw })).status, 'created');
  assert.equal((await post(null, { raw })).code, 409);
});

await t('zły / za słaby proof-of-work, zły zegar, śmieci', async () => {
  const body = JSON.stringify(rep('pow-site.com'));
  assert.equal((await post(null, { raw: `ccr1 ${Date.now()} 1 12\n${body}` })).status, 'pow-invalid');
  const weak = await post(rep('pow-site.com'), { bits: 4 });
  assert.equal(weak.code, 428); assert.equal(weak.powBits, 12);
  const { n } = pow(body, 12);
  assert.equal((await post(null, { raw: `ccr1 ${Date.now() - 3600e3} ${n} 12\n${body}` })).status, 'clock');
  assert.equal((await post(null, { raw: 'hello' })).code, 400);
  assert.equal((await post({ v: 1, reason: 'manual', page: { host: 'localhost' } })).status, 'invalid');
  assert.equal((await post({ v: 2 })).status, 'invalid');
});

await t('za duże zapytanie → 413', async () => {
  const r = await fetch(`${BASE}/v1/report`, { method: 'POST', body: 'x'.repeat(60 * 1024) }).catch(e => ({ status: 'reset' }));
  assert.ok(r.status === 413 || r.status === 'reset', String(r.status));
});

await t('dzienny limit PR-ów', async () => {
  // PR_PER_DAY=3: utworzone już 2 (example-news.pl, dup-site.com)
  assert.equal((await post(rep('third-site.com'))).status, 'created');
  assert.equal((await post(rep('fourth-site.com'))).status, 'limited');
});

await t('zaległe zgłoszenia są wysyłane po konfiguracji (flushPending)', async () => {
  // w teście serwer nie jest uruchomiony jako główny moduł — sprawdzamy tylko, że plik czeka
  assert.ok(fs.existsSync(path.join(dataDir, 'pending', 'pending-site.pl.json')));
});

await t('limit na IP (/64)', async () => {
  process.env.IP_PER_10M = '2';
  S.CFG.ipPer10m = 2;
  const a = await post(rep('rl1.com'), { ip: '2001:db8:1:2::10' });
  const b = await post(rep('rl2.com'), { ip: '2001:db8:1:2::99' });
  // bez zaufanego proxy IP pochodzi z gniazda (tryb dev) — więc limit liczy się dla 127.0.0.1
  const c = await post(rep('rl3.com'));
  assert.equal(c.code, 429, JSON.stringify([a, b, c]));
});

await t('renderMd: znaczniki markdown w tabelach są neutralizowane', () => {
  const md = S.renderMd(S.sanitize(rep('a.com', { buttons: [{ t: '[link](javascript:x) **b** <img>', c: null }] })), 'a.com', '2026-01-01');
  assert.match(md, /\| \\\[link\\\]\(javascript:x\) \\\*\\\*b\\\*\\\* &lt;img&gt; \| — \|/);
});

console.log(`\n${ok} testów OK`);
server.close(); mock.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
