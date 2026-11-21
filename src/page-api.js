/* Działa w świecie strony (MAIN). Udostępnia content scriptowi wywołania JS‑API
 * popularnych CMP (Cookiebot, Usercentrics), które pozwalają ustawić zgody precyzyjnie bez klikania. */
(() => {
  'use strict';
  const TAG = '__cookie_rejector__';
  if (window[TAG]) return;
  window[TAG] = true;

  const handlers = {
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
