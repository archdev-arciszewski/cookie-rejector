/* Działa w świecie strony (MAIN). Udostępnia content scriptowi wywołania JS‑API
 * popularnych CMP (Cookiebot, Usercentrics), które pozwalają ustawić zgody precyzyjnie bez klikania. */
(() => {
  'use strict';
  const TAG = '__cookie_rejector__';
  if (window[TAG]) return;
  window[TAG] = true;

  const handlers = {
    // Stan zgód IAB TCF (tylko odczyt): które cele mają zgodę / uzasadniony interes, funkcje specjalne.
    tcf() {
      return new Promise(resolve => {
        const api = window.__tcfapi;
        if (typeof api !== 'function') return resolve({ ok: false, none: true });
        const on = o => Object.entries(o || {}).filter(([, v]) => v === true).map(([k]) => +k);
        const sum = d => ({
          ok: true, cmpId: d.cmpId, gdprApplies: d.gdprApplies, eventStatus: d.eventStatus,
          purposeConsents: on(d.purpose && d.purpose.consents), purposeLI: on(d.purpose && d.purpose.legitimateInterests),
          vendorConsents: on(d.vendor && d.vendor.consents).length, vendorLI: on(d.vendor && d.vendor.legitimateInterests).length,
          specialFeatures: on(d.specialFeatureOptins)
        });
        const timer = setTimeout(() => resolve({ ok: false, timeout: true }), 1500);
        try {
          api('getTCData', 2, (d, ok) => {
            if (ok && d) { clearTimeout(timer); resolve(sum(d)); return; }
            api('addEventListener', 2, (d2, ok2) => {
              if (!ok2 || !d2) return;
              clearTimeout(timer);
              try { api('removeEventListener', 2, () => {}, d2.listenerId); } catch (e) { /* ignore */ }
              resolve(sum(d2));
            });
          });
        } catch (e) { clearTimeout(timer); resolve({ ok: false, error: String(e) }); }
      });
    },

    // Ponowne otwarcie ustawień CMP (żeby zgłosić sprzeciw wobec uzasadnionego interesu, który został po zapisie).
    // Tylko oficjalne wywołania „pokaż ustawienia” — nic nie jest tu akceptowane ani zapisywane.
    reopen(p) {
      const id = p && p.cmpId;
      try {
        if (window.OneTrust && typeof window.OneTrust.ToggleInfoDisplay === 'function' && (!id || id === 28)) {
          window.OneTrust.ToggleInfoDisplay(); return { ok: true, via: 'onetrust' };
        }
        if (window.Didomi && window.Didomi.preferences && typeof window.Didomi.preferences.show === 'function' && (!id || id === 7)) {
          window.Didomi.preferences.show(); return { ok: true, via: 'didomi' };
        }
        if (typeof window.__cmp === 'function' && (!id || id === 31)) {
          window.__cmp('showScreenAdvanced'); return { ok: true, via: 'consentmanager' };
        }
        if (typeof window.__tcfapi === 'function' && id === 10) { // InMobi Choice
          window.__tcfapi('displayConsentUi', 2, () => {}); return { ok: true, via: 'inmobi' };
        }
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      return { ok: false };
    },

    async cookiebot(p) {
      const cb = window.Cookiebot;
      if (!cb || typeof cb.submitCustomConsent !== 'function') return { ok: false };
      cb.submitCustomConsent(!!p.functional, !!p.analytics, !!(p.marketing || p.personalization || p.social));
      try { cb.hide && cb.hide(); } catch (e) { /* ignore */ }
      return { ok: true };
    },

    // Zwraca listę usług, żeby content script je sklasyfikował.
    async 'usercentrics-list'() {
      if (window.UC_UI && typeof window.UC_UI.getServicesBaseInfo === 'function') {
        const list = await window.UC_UI.getServicesBaseInfo();
        return { ok: true, version: 2, services: (list || []).map(s => ({ id: s.id, name: s.name, category: s.categorySlug || '', essential: s.categorySlug === 'essential' })) };
      }
      if (window.__ucCmp && typeof window.__ucCmp.getConsentDetails === 'function') {
        const d = await window.__ucCmp.getConsentDetails();
        const services = Object.entries((d && d.services) || {}).map(([id, s]) => ({
          id, name: s.name || '', category: s.category || '', essential: !!s.essential || s.category === 'essential'
        }));
        return { ok: true, version: 3, services };
      }
      return { ok: false };
    },

    async 'usercentrics-apply'(p) {
      const accept = p.accept || [], reject = p.reject || [];
      if (window.UC_UI && typeof window.UC_UI.acceptServices === 'function') {
        if (accept.length) await window.UC_UI.acceptServices(accept);
        if (reject.length) await window.UC_UI.rejectServices(reject);
        try { window.UC_UI.closeCMP && window.UC_UI.closeCMP(); } catch (e) { /* ignore */ }
        return { ok: true };
      }
      const uc = window.__ucCmp;
      if (uc && typeof uc.updateServicesConsents === 'function') {
        await uc.updateServicesConsents([...accept.map(id => ({ id, consent: true })), ...reject.map(id => ({ id, consent: false }))]);
        if (typeof uc.saveConsents === 'function') await uc.saveConsents();
        try { uc.closeCmp && uc.closeCmp(); } catch (e) { /* ignore */ }
        return { ok: true };
      }
      return { ok: false };
    }
  };

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.tag !== TAG || d.dir !== 'req') return;
    let result = { ok: false };
    try {
      const h = handlers[d.action];
      if (h) result = await h(d.payload || {});
    } catch (err) {
      result = { ok: false, error: String(err && err.message || err) };
    }
    window.postMessage({ tag: TAG, dir: 'res', id: d.id, result }, '*');
  });
})();
