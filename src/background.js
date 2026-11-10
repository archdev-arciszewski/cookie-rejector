/* Service worker: konfiguracja dla ramek, licznik na ikonie, log, decyzje dla ścian "zgoda albo płać",
 * przekazywanie promptu/toastu do ramki głównej, zamykanie kart. */
// Chromium: service worker → importScripts. Firefox: shared.js jest już wczytany przez manifest (background.scripts).
if (typeof importScripts === 'function' && !globalThis.CCR) importScripts('shared.js');
const api = CCR.api;

const LOG_MAX = 150;
const pendingWalls = new Map(); // tabId -> Promise<decision>

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
    api.storage.session.remove('count_' + tabId);
    api.action.setBadgeText({ tabId, text: '' });
  }
});

api.tabs.onRemoved.addListener(tabId => {
  api.storage.session.remove('count_' + tabId);
});
