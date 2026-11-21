// Klasyfikacja wyników crawla: node analyze.mjs <runDir z rozszerzeniem> [<runDir baseline>] [--rules path/to/rules.js] [--md out.md]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [extDir, baseDir] = pos;
const rulesPath = opt('--rules') || fileURLToPath(new URL('../../src/rules.js', import.meta.url));
createRequire(import.meta.url)(rulesPath);
const R = globalThis.CCR_RULES;
const any = (t, l) => l.some(r => r.test(t));
const load = d => d && existsSync(`${d}/results.jsonl`) ? readFileSync(`${d}/results.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const ext = load(extDir), base = new Map(load(baseDir).map(r => [r.url, r]));

function isAcceptLabel(t) {
  if (!t) return false;
  if (any(t, R.BTN_REJECT) || any(t, R.BTN_NOT_CONSENT)) return false;
  const acc = any(t, R.BTN_ACCEPT), all = any(t, R.WORD_ALL);
  if (any(t, R.BTN_SAVE) && !(acc && all)) return false;
  if (any(t, R.BTN_SETTINGS) && !(acc && all)) return false;
  return acc;
}

const rows = [];
for (const r of ext) {
  const b = base.get(r.url);
  const lines = [...new Set((r.logs || []).flatMap(f => f.log.map(l => l.replace(/^\d+ /, ''))))];
  const handled = lines.map(l => /^handled (\S+)/.exec(l)).filter(Boolean).map(m => m[1]);
  const offered = lines.map(l => /^nieobsłużone okienko (\S+)/.exec(l)).filter(Boolean).map(m => m[1]);
  const clicks = lines.filter(l => l.startsWith('click ')).map(l => l.slice(6).replace(/ [A-Z]+[#.].*$| [A-Z]+$/, ''));
  const wallAccept = lines.some(l => /wall decision accept/.test(l));
  const acceptClicks = wallAccept ? [] : clicks.filter(isAcceptLabel);
  const banner = lines.find(l => l.startsWith('baner ')) || '';
  const res = r.residual || {};
  const resid = (res.dialogs || []).length + (res.frames || []).length;
  const bres = b && b.residual || {};
  const bDialog = b ? ((bres.dialogs || []).length + (bres.frames || []).length) > 0 : null;
  const tcfBad = r.tcf && ((r.tcf.purposeConsents || []).filter(p => p !== 1).length > 0 || (r.tcf.specialFeatures || []).length > 0);
  const baseSame = tcfBad && b && b.tcf && (b.tcf.purposeConsents || []).filter(p => p !== 1).length > 0;
  let cls;
  if (r.error) cls = 'ERROR';
  else if (baseSame && !acceptClicks.length) cls = 'SITE_DEFAULT';
  else if (r.blocked) cls = 'BLOCKED';
  else if (acceptClicks.length || tcfBad) cls = 'BAD_ACCEPT';
  else if (res.ours && res.ours.prompt) cls = 'WALL_PROMPT';
  else if (offered.length) cls = 'OFFERED';
  else if (res.concealed) cls = 'CONCEALED_LEFT';
  else if (handled.length && !resid) cls = 'OK_HANDLED';
  else if (handled.length && resid) cls = 'HANDLED_RESIDUAL';
  else if (!handled.length && clicks.length) cls = 'CLICKED_NO_RESULT';
  else if (!handled.length && resid) cls = 'MISSED';
  else if (bDialog) cls = 'MISSED_GONE'; // bez wtyczki było okienko, z wtyczką ani obsługi, ani okienka (np. pojawia się później)
  else cls = 'OK_NOBANNER';
  rows.push({ idx: r.idx, url: r.url, country: r.country, cms: r.expectedCmp, cls, handled: handled.join(','), offered: offered.join(','), banner: banner.slice(6, 60),
    clicks: clicks.slice(0, 8), acceptClicks, resid: (res.dialogs || []).map(d => d.tag + ':' + d.text.slice(0, 80)).concat((res.frames || []).map(f => 'iframe:' + f.src.slice(0, 60))),
    base: b ? (bres.dialogs || []).map(d => d.tag + ':' + d.text.slice(0, 60)).concat((bres.frames || []).map(f => 'iframe:' + f.src.slice(0, 50))) : null,
    tcf: r.tcf ? `${r.tcf.eventStatus || ''} pc=${(r.tcf.purposeConsents || []).join('.')} li=${(r.tcf.purposeLI || []).join('.')} vc=${r.tcf.vendorConsents ?? ''}` : '', locked: res.locked, ms: r.ms });
}
const count = {};
for (const x of rows) count[x.cls] = (count[x.cls] || 0) + 1;
console.log(JSON.stringify(count));
const order = ['BAD_ACCEPT', 'SITE_DEFAULT', 'CONCEALED_LEFT', 'CLICKED_NO_RESULT', 'MISSED', 'HANDLED_RESIDUAL', 'OFFERED', 'WALL_PROMPT', 'MISSED_GONE', 'ERROR', 'BLOCKED', 'OK_HANDLED', 'OK_NOBANNER'];
rows.sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.idx - b.idx);
const md = opt('--md');
if (md) {
  const esc = s => String(s ?? '').replace(/\|/g, '¦').replace(/\n/g, ' ');
  let o = `# Crawl\n\n${JSON.stringify(count)}\n\n| # | klasa | url | cmp? | obsługa | baner | kliknięcia | po obsłudze | bez wtyczki | tcf |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const x of rows) o += `| ${x.idx} | ${x.cls} | ${esc(x.url)} | ${esc(x.cms)} | ${esc(x.handled || x.offered)} | ${esc(x.banner)} | ${esc(x.clicks.join(' → '))} | ${esc(x.resid.join(' ; ').slice(0, 160))} | ${esc((x.base || []).join(' ; ').slice(0, 120))} | ${esc(x.tcf)} |\n`;
  writeFileSync(md, o);
}
for (const x of rows) if (!/^OK_|SITE_DEFAULT|BLOCKED/.test(x.cls)) console.log(`${x.cls.padEnd(17)} ${String(x.idx).padStart(3)} ${x.url.slice(0, 55).padEnd(55)} ${x.handled || x.offered} | ${x.clicks.slice(0, 4).join(' → ').slice(0, 70)} | ${x.resid.join(' ; ').slice(0, 90)}`);
