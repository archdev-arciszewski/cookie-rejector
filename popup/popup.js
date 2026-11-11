'use strict';
const api = CCR.api;
const $ = s => document.querySelector(s);

(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const host = CCR.hostOf(tab && tab.url);
  const settings = await CCR.loadSettings();
  $('#host').textContent = host || '(strona systemowa)';

  const key = 'count_' + (tab && tab.id);
  const count = (await api.storage.session.get(key))[key] || 0;
  $('#stat').textContent = !settings.enabled ? 'Wtyczka jest wyłączona globalnie.'
    : count ? `Obsłużone banery na tej karcie: ${count}` : 'Na tej karcie nic jeszcze nie obsłużono.';

  const siteOn = $('#siteOn');
  siteOn.checked = !CCR.hostMatches(host, settings.disabledSites);
  siteOn.disabled = !host;
  siteOn.onchange = async () => {
    const s = await CCR.loadSettings();
    if (siteOn.checked) s.disabledSites = s.disabledSites.filter(h => !CCR.hostMatches(host, [h]));
    else s.disabledSites = [...new Set([...s.disabledSites, host])];
    await CCR.saveSettings(s);
  };

  const { siteDecisions = {} } = await api.storage.local.get('siteDecisions');
  if (siteDecisions[host]) {
    const d = $('#decision');
    d.innerHTML = `Zapamiętana decyzja („zgoda albo płać”): <b>${siteDecisions[host] === 'accept' ? 'akceptuj' : 'odmawiaj'}</b> `;
    const b = document.createElement('button');
    b.className = 'x'; b.textContent = 'zapomnij';
    b.onclick = async () => { delete siteDecisions[host]; await api.storage.local.set({ siteDecisions }); d.textContent = 'Decyzja zapomniana.'; };
    d.appendChild(b);
  }

  $('#rescan').onclick = async () => {
    if (tab) await api.tabs.sendMessage(tab.id, { type: 'rescan' }).catch(() => {});
    window.close();
  };
  const rep = $('#report');
  rep.disabled = !host || !tab;
  rep.onclick = async () => {
    rep.disabled = true;
    $('#reportStatus').textContent = 'Wysyłanie… (to potrwa kilka sekund)';
    const r = await api.runtime.sendMessage({ type: 'report-manual', tabId: tab.id, url: tab.url }).catch(() => null);
    $('#reportStatus').textContent = (r && r.text) || 'Nie udało się wysłać zgłoszenia.';
  };

  $('#options').onclick = () => { api.runtime.openOptionsPage(); window.close(); };
})();
