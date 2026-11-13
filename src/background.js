/* Service worker: konfiguracja dla ramek, licznik na ikonie, log, decyzje dla ścian "zgoda albo płać",
 * przekazywanie promptu/toastu do ramki głównej, zamykanie kart. */
// Chromium: service worker → importScripts. Firefox: shared.js jest już wczytany przez manifest (background.scripts).
if (typeof importScripts === 'function' && !globalThis.CCR) importScripts('shared.js', 'pow.js');
const api = CCR.api;

const LOG_MAX = 150;
const pendingWalls = new Map(); // tabId -> Promise<decision>
const REPORT_REMEMBER_MS = 90 * 864e5;
const POW_BITS = 20;

const METHOD_LABEL = {
  granular: 'Zapisano własny wybór',
  reject: 'Odrzucono zgody',
  api: 'Ustawiono zgody (API CMP)',
  hidden: 'Ukryto baner informacyjny',
  'info-accept': 'Zamknięto baner informacyjny',
  'wall-accept': 'Zaakceptowano (Twoja decyzja)',
  'wall-decline': 'Odmówiono (Twoja decyzja)'
};

const CAT_SHORT = {
  functional: 'funkcjonalne', analytics: 'analityczne', marketing: 'reklamowe', personalization: 'personalizacja',
  social: 'social media', thirdParty: 'partnerzy', legitimateInterest: 'uzasadniony interes', other: 'pozostałe'
};

api.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await api.storage.sync.get('settings');
  if (!settings) await CCR.saveSettings(CCR.DEFAULT_SETTINGS);
  if (reason === 'install') api.runtime.openOptionsPage();
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, err => sendResponse({ error: String(err) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  const topUrl = (sender.tab && sender.tab.url) || '';
  const host = CCR.hostOf(topUrl);

  switch (msg && msg.type) {
    case 'init': {
      const settings = await CCR.loadSettings();
      return { settings, topHost: host, disabled: CCR.hostMatches(host, settings.disabledSites) };
    }

    case 'handled': {
      const settings = await CCR.loadSettings();
      await bumpCount(tabId);
      await addLog({ host, frameHost: msg.frameHost, method: msg.method, cmp: msg.cmp, cats: msg.cats || null });
      if (settings.notifications && tabId != null) toast(tabId, msg);
      return { ok: true };
    }

    case 'wall': {
      if (tabId == null) return { decision: 'none' };
      if (pendingWalls.has(tabId)) return { decision: await pendingWalls.get(tabId) };
      const p = decideWall(tabId, host, msg);
      pendingWalls.set(tabId, p);
      try { return { decision: await p }; } finally { setTimeout(() => pendingWalls.delete(tabId), 3000); }
    }

    case 'unhandled':
      return onUnhandled(tabId, topUrl, msg.data);

    case 'report-answer':
      return onReportAnswer(tabId, msg.decision);

    case 'report-manual':
      return manualReport(msg.tabId, msg.url);

    default:
      return null;
  }
}

async function decideWall(tabId, host, msg) {
  const settings = await CCR.loadSettings();
  const { siteDecisions = {} } = await api.storage.local.get('siteDecisions');
  let decision = siteDecisions[host];
  let source = 'pamięć';

  if (!decision) {
    if (settings.wall.mode === 'accept') { decision = 'accept'; source = 'ustawienia'; }
    else if (settings.wall.mode === 'decline') { decision = 'decline'; source = 'ustawienia'; }
    else {
      source = 'pytanie';
      try {
        const r = await api.tabs.sendMessage(tabId, {
          type: 'wall-prompt', kind: msg.kind, host, onDecline: settings.wall.onDecline, remember: settings.wall.remember
        }, { frameId: 0 });
        decision = r && r.decision;
        if (decision && r.remember) {
          siteDecisions[host] = decision;
          await api.storage.local.set({ siteDecisions });
        }
      } catch (e) {
        decision = null;
      }
    }
  }
  if (!decision) return 'none';

  await addLog({ host, method: decision === 'accept' ? 'wall-accept' : 'wall-decline', cmp: msg.cmp, kind: msg.kind, source });
  if (decision === 'decline' && settings.wall.onDecline === 'close') {
    setTimeout(() => api.tabs.remove(tabId).catch(() => {}), 250);
  }
  return decision;
}

// ======================================================================
// Zgłoszenia nieobsłużonych okienek
// ======================================================================
const REPORT_TEXT = {
  created: 'Dziękuję! Zgłoszenie trafiło na GitHuba — obsługa pojawi się w jednej z kolejnych wersji.',
  known: 'To okienko jest już zgłoszone — obsługa pojawi się w jednej z kolejnych wersji. Dziękuję!',
  stored: 'Dziękuję! Zgłoszenie zostało przyjęte.',
  'rate-limited': 'Za dużo zgłoszeń w krótkim czasie — spróbuj później.',
  limited: 'Dzienny limit zgłoszeń został wyczerpany — spróbuj jutro.',
  busy: 'Serwer zgłoszeń jest teraz zajęty — spróbuj za chwilę.',
  duplicate: 'To zgłoszenie zostało już wysłane.',
  'invalid-host': 'Nie udało się zgłosić: adres strony nie jest obsługiwany.',
  network: 'Nie udało się połączyć z serwerem zgłoszeń.'
};
const reportText = r => REPORT_TEXT[r.status] || `Nie udało się wysłać zgłoszenia (${r.status}).`;

function withPage(data, tabUrl) {
  const u = new URL(tabUrl);
  return { ...data, page: { ...(data.page || {}), host: u.hostname.toLowerCase(), path: u.pathname.slice(0, 300) } };
}

const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
/** Proof-of-work (src/pow.js): ok. sekundy obliczeń po stronie wysyłającego chroni serwer przed masowym spamem. */
async function proofOfWork(body, bits) {
  const bh = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const ts = Date.now();
  return { ts, nonce: CCR_POW.solve(bh, ts, bits) };
}

async function sendReport(data) {
  const body = JSON.stringify(data);
  let bits = POW_BITS;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { ts, nonce } = await proofOfWork(body, bits);
    let res;
    try {
      res = await fetch(CCR.REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // „prosty” request — bez preflightu CORS
        body: `ccr1 ${ts} ${nonce} ${bits}\n${body}`,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
    } catch (e) {
      return { status: 'network' };
    }
    let j = {};
    try { j = await res.json(); } catch {}
    if (res.status === 428 && j.powBits > bits && j.powBits <= 26) { bits = j.powBits; continue; }
    return { status: j.status || `http-${res.status}`, url: j.url || null };
  }
  return { status: 'pow' };
}

async function rememberReport(key, decision) {
  const { reportedSites = {} } = await api.storage.local.get('reportedSites');
  const now = Date.now();
  for (const [k, v] of Object.entries(reportedSites)) if (now - v.t > REPORT_REMEMBER_MS) delete reportedSites[k];
  if (decision) reportedSites[key] = { t: now, d: decision }; else delete reportedSites[key];
  await api.storage.local.set({ reportedSites });
}

function reportToast(tabId, text) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  api.tabs.sendMessage(tabId, { type: 'toast', html: `🍪 ${esc(text)}` }, { frameId: 0 }).catch(() => {});
}

async function deliver(tabId, key, data) {
  if (tabId != null) reportToast(tabId, 'Wysyłam zgłoszenie…');
  const res = await sendReport(data);
  const ok = ['created', 'known', 'stored', 'duplicate'].includes(res.status);
  await rememberReport(key, ok ? 'sent' : null);
  await addLog({ host: data.page.host, method: ok ? 'report' : 'report-failed', cmp: data.cmp || '', status: res.status });
  if (tabId != null) reportToast(tabId, reportText(res));
  return { ...res, text: reportText(res) };
}

// Dane zgłoszenia czekają w storage.session, a odpowiedź przychodzi osobną wiadomością —
// service worker może zostać uśpiony, zanim użytkownik kliknie.
async function onUnhandled(tabId, tabUrl, data) {
  const settings = await CCR.loadSettings();
  if (!settings.reportUnsupported || tabId == null || !data || !/^https?:/.test(tabUrl)) return { ok: false };
  const key = CCR.baseDomain(CCR.hostOf(tabUrl));
  const { reportedSites = {} } = await api.storage.local.get('reportedSites');
  const prev = reportedSites[key];
  if (prev && Date.now() - prev.t < REPORT_REMEMBER_MS) return { ok: false, skip: prev.d };
  const sk = 'report_' + tabId;
  if ((await api.storage.session.get(sk))[sk]) return { ok: false };
  await api.storage.session.set({ [sk]: { key, data: withPage(data, tabUrl) } });
  api.tabs.sendMessage(tabId, { type: 'report-prompt', host: key }, { frameId: 0 }).catch(() => api.storage.session.remove(sk));
  return { ok: true };
}

async function onReportAnswer(tabId, decision) {
  if (tabId == null) return { ok: false };
  const sk = 'report_' + tabId;
  const pending = (await api.storage.session.get(sk))[sk];
  await api.storage.session.remove(sk);
  if (!pending) return { ok: false };
  if (decision !== 'send') { await rememberReport(pending.key, 'no'); return { ok: true }; }
  return deliver(tabId, pending.key, pending.data);
}

async function manualReport(tabId, tabUrl) {
  if (tabId == null || !/^https?:/.test(tabUrl || '')) return { status: 'invalid-host', text: REPORT_TEXT['invalid-host'] };
  // najpierw ramka główna (tam zwykle jest okienko; odpowiedź ramki reklamowej nie może jej przesłonić),
  // potem wszystkie ramki (okienko CMP w iframe)
  let r = await api.tabs.sendMessage(tabId, { type: 'collect-report' }, { frameId: 0 }).catch(() => null);
  if (!r || !r.data || (!r.data.text && r.data.page && r.data.page.top)) {
    const any = await api.tabs.sendMessage(tabId, { type: 'collect-report', frames: true }).catch(() => null);
    if (any && any.data && any.data.text) r = any;
  }
  if (!r || !r.data) {
    return { status: 'no-content', text: 'Wtyczka nie działa na tej karcie — odśwież stronę (np. po instalacji lub aktualizacji wtyczki) i spróbuj ponownie.' };
  }
  return deliver(tabId, CCR.baseDomain(CCR.hostOf(tabUrl)), withPage(r.data, tabUrl));
}

async function bumpCount(tabId) {
  if (tabId == null) return;
  const key = 'count_' + tabId;
  const cur = (await api.storage.session.get(key))[key] || 0;
  await api.storage.session.set({ [key]: cur + 1 });
  api.action.setBadgeBackgroundColor({ tabId, color: '#1f6feb' });
  api.action.setBadgeText({ tabId, text: String(cur + 1) });
}

async function addLog(entry) {
  const { log = [] } = await api.storage.local.get('log');
  log.unshift({ t: Date.now(), ...entry });
  await api.storage.local.set({ log: log.slice(0, LOG_MAX) });
}

function toast(tabId, msg) {
  const label = METHOD_LABEL[msg.method] || msg.method;
  let detail = '';
  if (msg.cats && typeof msg.cats === 'object') {
    const on = [], off = [];
    for (const [k, v] of Object.entries(msg.cats)) {
      if (!CAT_SHORT[k]) continue;
      (v ? on : off).push(CAT_SHORT[k]);
    }
    if (on.length) detail += ` ✓ ${on.join(', ')}`;
    if (off.length) detail += ` ✗ ${off.join(', ')}`;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `🍪 <b>${esc(label)}</b> · ${esc(msg.cmp || '')}${detail ? '<br>' + esc(detail) : ''}`;
  api.tabs.sendMessage(tabId, { type: 'toast', html }, { frameId: 0 }).catch(() => {});
}

api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // nowa strona w karcie: porzucony (bez odpowiedzi) prompt nie może blokować kolejnych
    pendingWalls.delete(tabId);
    api.storage.session.remove('report_' + tabId);
    api.storage.session.remove('count_' + tabId);
    api.action.setBadgeText({ tabId, text: '' });
  }
});

api.tabs.onRemoved.addListener(tabId => {
  api.storage.session.remove('count_' + tabId);
});
