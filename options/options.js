'use strict';
let settings = null;

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const METHOD = {
  granular: 'własny wybór', reject: 'odrzucono', api: 'API CMP', hidden: 'ukryto baner', 'info-accept': 'OK na banerze',
  'wall-accept': 'ściana: zaakceptowano', 'wall-decline': 'ściana: odmówiono'
};

function getPath(obj, path) { return path.split('.').reduce((o, k) => o && o[k], obj); }
function setPath(obj, path, v) {
  const ks = path.split('.'); const last = ks.pop();
  ks.reduce((o, k) => o[k], obj)[last] = v;
}

let savedTimer;
async function save() {
  await CCR.saveSettings(settings);
  const el = $('#saved');
  el.textContent = 'Zapisano ✓';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function renderCats() {
  const box = $('#cats');
  box.innerHTML = '';
  for (const c of CCR.CATEGORY_DEFS) {
    const row = document.createElement('label');
    row.className = 'row' + (c.locked ? ' locked' : '');
    row.innerHTML = `<span><b>${esc(c.label)}</b><small>${esc(c.desc)}</small></span>
      <input type="checkbox" class="switch" data-path="categories.${c.key}" ${c.locked ? 'disabled' : ''}>`;
    box.appendChild(row);
  }
}

function bindInputs() {
  for (const el of document.querySelectorAll('[data-path]')) {
    const path = el.dataset.path;
    const v = getPath(settings, path);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.onchange = () => {
      setPath(settings, path, el.type === 'checkbox' ? el.checked : el.value);
      save();
    };
  }
  const ta = $('#disabledSites');
  ta.value = settings.disabledSites.join('\n');
  ta.onchange = () => {
    settings.disabledSites = ta.value.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    save();
  };
}

async function renderDecisions() {
  const { siteDecisions = {} } = await chrome.storage.local.get('siteDecisions');
  const box = $('#decisions');
  const entries = Object.entries(siteDecisions).sort();
  if (!entries.length) { box.innerHTML = '<div class="empty">Brak zapamiętanych decyzji.</div>'; return; }
  box.innerHTML = '';
  for (const [host, d] of entries) {
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `<span class="grow">${esc(host)}</span>
      <span class="tag ${d}">${d === 'accept' ? 'akceptuj' : 'odmawiaj'}</span>
      <button class="x" title="Zapomnij">✕</button>`;
    it.querySelector('button').onclick = async () => {
      delete siteDecisions[host];
      await chrome.storage.local.set({ siteDecisions });
      renderDecisions();
    };
    box.appendChild(it);
  }
}

async function renderLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  const box = $('#log');
  if (!log.length) { box.innerHTML = '<div class="empty">Jeszcze nic nie obsłużono.</div>'; return; }
  box.innerHTML = log.slice(0, 40).map(e => {
    const d = new Date(e.t);
    const time = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    return `<div class="item"><span class="time">${time}</span><span class="grow">${esc(e.host || e.frameHost || '?')}</span>
      <span class="tag">${esc(e.cmp || '')}</span><span class="tag">${esc(METHOD[e.method] || e.method)}</span></div>`;
  }).join('');
}

$('#clearLog').onclick = async () => { await chrome.storage.local.set({ log: [] }); renderLog(); };
$('#reset').onclick = async () => {
  if (!confirm('Przywrócić ustawienia domyślne? (Zapamiętane decyzje i log zostaną.)')) return;
  settings = CCR.mergeSettings(null);
  await save();
  bindInputs();
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.log) renderLog();
  if (area === 'local' && changes.siteDecisions) renderDecisions();
});

(async () => {
  settings = await CCR.loadSettings();
  renderCats();
  bindInputs();
  renderDecisions();
  renderLog();
})();
