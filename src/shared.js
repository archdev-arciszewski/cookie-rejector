/* Wspólne definicje: kategorie, ustawienia domyślne, pomocnicze funkcje.
 * Ładowane w content scripts, service workerze (importScripts) i stronach opcji/popupu. */
(function (g) {
  'use strict';

  // Firefox udostępnia `browser` (Promise), Chromium `chrome` — ten sam kod działa w obu.
  const api = (g.browser && g.browser.runtime) ? g.browser : g.chrome;

  const CATEGORY_DEFS = [
    { key: 'necessary', label: 'Niezbędne', desc: 'Ściśle wymagane do działania strony (logowanie, koszyk, bezpieczeństwo). Zwykle nie da się ich wyłączyć.', locked: true },
    { key: 'functional', label: 'Funkcjonalne / preferencje', desc: 'Zapamiętywanie języka, regionu, ustawień, odtwarzaczy itp.' },
    { key: 'analytics', label: 'Analityczne / statystyczne / wydajnościowe', desc: 'Pomiar ruchu, statystyki odwiedzin, badania oglądalności.' },
    { key: 'marketing', label: 'Marketingowe / reklamowe', desc: 'Reklamy, targetowanie, remarketing, pomiar skuteczności reklam.' },
    { key: 'personalization', label: 'Personalizacja i profilowanie', desc: 'Budowanie profilu, spersonalizowane treści, dopasowanie.' },
    { key: 'social', label: 'Media społecznościowe', desc: 'Wtyczki i śledzenie serwisów społecznościowych.' },
    { key: 'thirdParty', label: 'Udostępnianie partnerom / dostawcom (third‑party)', desc: 'Przekazywanie danych zewnętrznym podmiotom (listy „vendors”/„partnerzy”).' },
    { key: 'legitimateInterest', label: 'Uzasadniony interes', desc: 'Przetwarzanie bez zgody na podstawie „prawnie uzasadnionego interesu” — wtyczka zgłasza sprzeciw.' },
    { key: 'other', label: 'Pozostałe / niesklasyfikowane', desc: 'Wszystko, czego nie udało się przypisać (np. TCF: przechowywanie na urządzeniu, geolokalizacja, skanowanie urządzenia).' }
  ];

  const OPTIONAL_KEYS = CATEGORY_DEFS.filter(c => !c.locked).map(c => c.key);

  const DEFAULT_SETTINGS = {
    enabled: true,
    categories: {
      necessary: true,
      functional: true,
      analytics: false,
      marketing: false,
      personalization: false,
      social: false,
      thirdParty: false,
      legitimateInterest: false,
      other: false
    },
    // Próbuj otworzyć ustawienia szczegółowe i ustawić przełączniki per kategoria.
    granular: true,
    // Gdy szczegółowe ustawienie się nie uda: 'reject' = kliknij "Odrzuć wszystkie", 'none' = nic nie rób.
    fallback: 'reject',
    wall: {
      // 'ask' = zapytaj mnie, 'accept' = akceptuj automatycznie, 'decline' = odmawiaj automatycznie
      mode: 'ask',
      // co zrobić po odmowie: 'close' = zamknij kartę, 'nothing' = nic
      onDecline: 'nothing',
      // domyślny stan checkboxa "zapamiętaj dla tej domeny"
      remember: true
    },
    // Banery z samym "OK/Akceptuj" (nieblokujące): 'hide' = ukryj, 'accept' = kliknij, 'ignore' = zostaw
    infoBanner: 'hide',
    notifications: true,
    // Gdy wtyczka wykryje okienko cookie, którego nie umie obsłużyć — zaproponuj zgłoszenie (nic nie jest wysyłane bez kliknięcia).
    reportUnsupported: true,
    disabledSites: [],
    debug: false
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeSettings(stored) {
    const out = clone(DEFAULT_SETTINGS);
    if (!stored || typeof stored !== 'object') return out;
    for (const k of Object.keys(out)) {
      if (!(k in stored)) continue;
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = Object.assign(out[k], stored[k] || {});
      } else {
        out[k] = stored[k];
      }
    }
    out.categories.necessary = true;
    if (!Array.isArray(out.disabledSites)) out.disabledSites = [];
    return out;
  }

  async function loadSettings() {
    const { settings } = await api.storage.sync.get('settings');
    return mergeSettings(settings);
  }

  async function saveSettings(s) {
    await api.storage.sync.set({ settings: mergeSettings(s) });
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  /** host pasuje do listy, jeśli równy wpisowi lub jest jego subdomeną. */
  function hostMatches(host, list) {
    if (!host) return false;
    host = host.replace(/^www\./, '');
    return (list || []).some(entry => {
      const e = String(entry).trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
      return e && (host === e || host.endsWith('.' + e));
    });
  }

  // Serwer zgłoszeń nieobsługiwanych okienek (kod: server/ w repozytorium).
  const REPORT_URL = 'https://ted160-30160.mikrus.cloud/v1/report';

  // Domena „rejestrowalna” (www.sklep.example.com.pl → example.com.pl) — ta sama reguła co na serwerze.
  const MULTI_TLD = new Set(('co.uk org.uk ac.uk gov.uk me.uk com.pl net.pl org.pl edu.pl gov.pl info.pl biz.pl waw.pl ' +
    'com.au net.au org.au co.jp ne.jp co.nz com.br com.tr co.in co.za com.mx com.ar com.cn com.ua co.kr co.il ' +
    'com.sg com.hk com.tw co.at or.at com.es com.pt com.gr com.ro co.id com.my com.ph com.vn').split(' '));
  function baseDomain(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\d*\./, '');
    const p = h.split('.');
    if (p.length <= 2) return h;
    return MULTI_TLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  }

  g.CCR = { api, CATEGORY_DEFS, OPTIONAL_KEYS, DEFAULT_SETTINGS, REPORT_URL, mergeSettings, loadSettings, saveSettings, hostOf, hostMatches, baseDomain };
})(globalThis);
