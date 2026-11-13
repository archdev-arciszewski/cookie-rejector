/* Silnik: wykrywa banery zgód, ustawia kategorie zgodnie z konfiguracją, odrzuca resztę,
 * a przy ścianach "zgoda albo płać" pyta użytkownika (przez background → ramka główna). */
(() => {
  'use strict';
  if (window.__ccrLoaded) return;
  window.__ccrLoaded = true;

  const api = globalThis.CCR.api;
  const R = globalThis.CCR_RULES;
  const UI = globalThis.CCR_UI;
  const IS_TOP = window === window.top;
  const PAGE_TAG = '__cookie_rejector__';

  const SCAN_WINDOW_MS = 60000;   // jak długo obserwujemy DOM po załadowaniu
  const MAX_ATTEMPTS = 5;         // maks. liczba obsłużonych banerów na ramkę
  const HANDLE_TIMEOUT_MS = 20000; // dłuższa obsługa jest przerywana, a okienko zgłaszane

  let settings = null;
  let topHost = '';
  let attempts = 0;
  let busy = false;
  let aborted = false;            // obsługa przerwana po przekroczeniu czasu — nic więcej nie klikamy
  let wallAsked = false;
  let reported = false;
  let unrecognizedChecks = 0;
  let startedAt = Date.now();
  let observer = null;
  let scanTimer = null;
  const handledRoots = new WeakSet();

  // Opóźnienie pauz ponad zadany czas to praca strony (zablokowany wątek, np. render ciężkiego panelu ustawień).
  // Ten czas nie obciąża limitu obsługi — liczy się tylko oczekiwanie samej wtyczki.
  let pageJankMs = 0;
  const sleep = ms => new Promise(r => {
    const t = performance.now();
    setTimeout(() => { const over = performance.now() - t - ms; if (over > 100) pageJankMs += over; r(); }, ms);
  });
  // Limit czasu obsługi liczony bez czasu, w którym strona blokowała wątek (maks. +40 s). Sprawdzany przy każdym
  // checkAbort — nie tylko przez timer, który w karcie w tle przeglądarka spowalnia do ~1 s.
  let handleT0 = 0;
  const overDeadline = () => handleT0 > 0 && performance.now() - handleT0 > HANDLE_TIMEOUT_MS + Math.min(pageJankMs, 40000);
  const checkAbort = () => {
    if (!aborted && overDeadline()) { aborted = true; log('obsługa trwa zbyt długo — przerywam'); }
    if (aborted) throw new Error('obsługa przerwana (limit czasu)');
  };
  // oddanie sterowania stronie bez timera (MessageChannel nie jest spowalniany w kartach w tle)
  const yieldNow = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  const log = (...a) => { if (settings && settings.debug) console.debug('[CookieRejector]', location.hostname, ...a); };

  // ======================================================================
  // Narzędzia DOM / tekst
  // ======================================================================
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ł/g, 'l').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  }
  const any = (t, list) => list.some(re => re.test(t));

  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const rn = el.getRootNode && el.getRootNode();
    return rn && rn.host ? rn.host : null;
  }

  function containsDeep(a, b) {
    for (let n = b; n; n = parentOf(n)) if (n === a) return true;
    return false;
  }

  // Lista hostów Shadow DOM zapamiętana na czas jednego synchronicznego przebiegu (np. findBanners sprawdza
  // ~25 reguł CMP — bez tego 25 razy przechodziłby cały dokument). Czyszczona w najbliższym mikrozadaniu.
  let hostCache = null;
  function shadowHosts(root) {
    if (!hostCache) { hostCache = new Map(); queueMicrotask(() => { hostCache = null; }); }
    let out = hostCache.get(root);
    if (!out) {
      out = [];
      for (const e of root.querySelectorAll('*')) if (e.shadowRoot) out.push(e);
      hostCache.set(root, out);
    }
    return out;
  }

  function deepQueryAll(root, sel, out = []) {
    try { root.querySelectorAll(sel).forEach(e => out.push(e)); } catch (e) { return out; }
    for (const h of shadowHosts(root)) deepQueryAll(h.shadowRoot, sel, out);
    if (root.shadowRoot) deepQueryAll(root.shadowRoot, sel, out);
    return out;
  }

  function deepText(el) {
    let t = el.innerText || '';
    if (el.shadowRoot) t += ' ' + Array.from(el.shadowRoot.children).map(c => c.innerText || '').join(' ');
    for (const h of shadowHosts(el)) t += ' ' + Array.from(h.shadowRoot.children).map(c => c.innerText || '').join(' ');
    return t;
  }

  const HAS_CHECK_VIS = typeof Element !== 'undefined' && typeof Element.prototype.checkVisibility === 'function';
  // jeden argument: isVisible bywa przekazywana wprost do filter/find/some (drugi argument to indeks)
  const isVisible = el => visibleCheck(el, false);
  /** anyOpacity: pomija przezroczystość (panel, który sami otworzyliśmy i który właśnie się pojawia z animacją). */
  function visibleCheck(el, anyOpacity) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // natywne sprawdzenie (display/visibility/opacity całego łańcucha przodków) — wielokrotnie szybsze niż ręczne
    if (HAS_CHECK_VIS) {
      return el.checkVisibility(anyOpacity ? { checkVisibilityCSS: true, visibilityProperty: true }
        : { checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
    }
    let n = el, depth = 0;
    while (n && depth++ < 25) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (!anyOpacity && parseFloat(cs.opacity) < 0.05)) return false;
      n = parentOf(n);
    }
    return true;
  }

  /** Widoczność z uwzględnieniem hostów Shadow DOM o zerowym rozmiarze (np. Usercentrics). */
  function isShown(el) {
    if (isVisible(el)) return true;
    if (el && el.isConnected && el.shadowRoot) {
      return deepQueryAll(el.shadowRoot, 'button, [role="button"], [role="dialog"]').some(isVisible);
    }
    return false;
  }

  function isFloating(el) {
    let n = el, depth = 0;
    while (n && n !== document.body && n !== document.documentElement && depth++ < 30) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
      if (n.matches && n.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true;
      n = parentOf(n);
    }
    return false;
  }

  function isBlocking(root) {
    if (root.closest && root.closest('[aria-modal="true"], dialog[open]')) return true;
    const r = root.getBoundingClientRect();
    if (r.width * r.height > 0.45 * innerWidth * innerHeight) return true;
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === 'hidden') return true;
    }
    // nakładka zasłaniająca środek ekranu
    const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (c && !containsDeep(root, c)) {
      let n = c, d = 0;
      while (n && d++ < 6) {
        const cs = getComputedStyle(n);
        const rr = n.getBoundingClientRect();
        if (cs.position === 'fixed' && rr.width >= innerWidth * 0.9 && rr.height >= innerHeight * 0.9) return true;
        n = parentOf(n);
      }
    }
    return !IS_TOP; // w iframe CMP (np. Sourcepoint) zwykle jest pełnoekranową nakładką
  }

  function cookieScore(t) {
    let s = 0;
    for (const re of R.TXT_STRONG) if (re.test(t)) s += 3;
    for (const re of R.TXT_WEAK) if (re.test(t)) s += 1;
    return s;
  }

  // ======================================================================
  // Przyciski
  // ======================================================================
  const ACTION_SEL = 'button, [role="button"], a, input[type="button"], input[type="submit"], [onclick], [tabindex]:not([tabindex="-1"])';

  function navigatesAway(a) {
    if (a.tagName !== 'A' || a.getAttribute('role') === 'button') return false;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false;
    try {
      const u = new URL(href, location.href);
      return !(u.origin === location.origin && u.pathname === location.pathname && u.search === location.search);
    } catch { return false; }
  }

  function labelOf(el) {
    let t = '';
    if (el.tagName === 'INPUT') t = el.value || '';
    if (!t) t = el.innerText || '';
    if (!t.trim()) t = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return norm(t);
  }

  function classifyButton(t) {
    if (!t || t.length > 90) return null;
    // płatność ma pierwszeństwo: "Nadal odrzucam, chcę zapłacić" to NIE jest zwykłe "Odrzuć"
    if (any(t, R.PAY_METHOD)) return null; // „Google Pay”, „BLIK”, „Płatność kartą” — metoda płatności, nie przycisk zgody
    if (any(t, R.BTN_PAY) && !any(t, R.PAY_NEGATED)) return 'pay';
    if (any(t, R.BTN_REJECT)) return 'reject';
    const acc = any(t, R.BTN_ACCEPT);
    const all = any(t, R.WORD_ALL);
    if (any(t, R.BTN_SAVE) && !(acc && all)) return 'save';
    if (any(t, R.BTN_SETTINGS) && !(acc && all)) return 'settings';
    if (acc) return 'accept';
    if (R.BTN_CLOSE.test(t)) return 'close';
    return null;
  }

  function actionables(root) {
    const list = deepQueryAll(root, ACTION_SEL);
    if (root.matches && root.matches(ACTION_SEL)) list.push(root);
    const set = new Set();
    for (const el of list) {
      if (el.matches('input[type="checkbox"], [role="switch"], [role="checkbox"], [role="tab"]')) continue;
      if (navigatesAway(el)) continue;
      set.add(el);
    }
    // „Przyciski” bez znaczników (div/span z obsługą kliknięcia w JS, częste w React/Tailwind):
    // kursor-łapka, krótki tekst, bez przełączników w środku. Kursor się dziedziczy — bierzemy element,
    // którego rodzic nie ma łapki. Tylko w niedużych okienkach (getComputedStyle dla każdego elementu).
    try {
      const plain = root.querySelectorAll ? root.querySelectorAll('div, span, li, label, p') : [];
      if (plain.length && plain.length < 1500) {
        for (const el of plain) {
          if (set.has(el) || getComputedStyle(el).cursor !== 'pointer') continue;
          const p = el.parentElement;
          if (p && getComputedStyle(p).cursor === 'pointer') continue;
          if (el.querySelector(`${ACTION_SEL}, ${TOGGLE_SEL}`)) continue;
          const t = (el.innerText || '').trim();
          if (t && t.length <= 60) set.add(el);
        }
      }
    } catch (e) { /* ignore */ }
    // jeśli przycisk zawiera inny przycisk z tym samym tekstem — zostaw wewnętrzny
    // (przodkowie zamiast porównań każdy z każdym: listy dostawców mają setki linków)
    const labels = new Map();
    const lab = el => { if (!labels.has(el)) labels.set(el, labelOf(el)); return labels.get(el); };
    const drop = new Set();
    for (const el of set) {
      for (let p = parentOf(el), d = 0; p && d < 40; p = parentOf(p), d++) {
        if (set.has(p) && !drop.has(p) && lab(p) === lab(el)) drop.add(p);
      }
    }
    return [...set].filter(el => !drop.has(el));
  }

  function analyze(root, cmp, anyOpacity = false) {
    const b = { reject: [], save: [], settings: [], accept: [], pay: [], close: [] };
    const vis = el => visibleCheck(el, anyOpacity);
    for (const el of actionables(root)) {
      const c = classifyButton(labelOf(el));
      if (c && vis(el)) b[c].push(el); // widoczność tylko dla rozpoznanych (kosztowna przy setkach elementów)
    }
    if (cmp) {
      for (const k of ['reject', 'settings', 'save', 'accept']) {
        if (!cmp[k]) continue;
        const known = deepQueryAll(document, cmp[k]).filter(vis);
        if (known.length) {
          for (const kk of Object.keys(b)) b[kk] = b[kk].filter(e => !known.includes(e));
          b[k] = [...known, ...b[k]];
        }
      }
    }
    return b;
  }

  async function click(el) {
    checkAbort();
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
    log('click', labelOf(el), el);
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } catch (e) { /* ignore */ }
    el.click();
    await sleep(100); // dalsze czekanie (waitFor/waitGone) odpytuje stan, więc tu wystarczy chwila
  }

  async function waitGone(els, ms = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      checkAbort();
      if (els.filter(Boolean).every(e => !isShown(e))) return true;
      await sleep(50);
    }
    return false;
  }

  async function waitFor(fn, ms = 4000, step = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      checkAbort();
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ======================================================================
  // Obsługa „w tle”: okienko jest niewidoczne, dopóki go nie obsłużymy
  // ======================================================================
  // clip-path zamiast opacity/visibility/display: nie zmienia niczego, co sprawdzamy (rozmiar, widoczność,
  // przezroczystość), nie tworzy bloku zawierającego dla potomków position:fixed (jak transform/filter)
  // i wyłącza trafianie kursorem — użytkownik nie kliknie niewidocznego przycisku.
  const concealed = new Map(); // element → [poprzednia wartość, priorytet] inline clip-path
  let revealTimer = null;
  const hideOn = () => !!(settings && settings.hideWhileHandling);

  // okienka często blokują przewijanie (overflow: hidden na html/body) — gdy są ukryte, strona ma się przewijać
  const unlocked = new Map(); // html/body → [poprzednia wartość, priorytet] inline overflow
  function unlockScroll() {
    if (!IS_TOP) return;
    for (const el of [document.documentElement, document.body]) {
      if (!el || unlocked.has(el) || getComputedStyle(el).overflowY !== 'hidden') continue;
      unlocked.set(el, [el.style.getPropertyValue('overflow'), el.style.getPropertyPriority('overflow')]);
      el.style.setProperty('overflow', 'auto', 'important');
    }
  }

  function conceal(el) {
    if (!hideOn() || !el || !el.style || concealed.has(el)) return;
    if (el === document.documentElement || (el === document.body && IS_TOP) || (el.id && el.id.startsWith('ccr-'))) return;
    concealed.set(el, [el.style.getPropertyValue('clip-path'), el.style.getPropertyPriority('clip-path')]);
    el.style.setProperty('clip-path', 'inset(50%)', 'important');
    unlockScroll();
  }

  function reveal() {
    clearTimeout(revealTimer);
    for (const [el, [v, p]] of concealed) {
      if (v) el.style.setProperty('clip-path', v, p); else el.style.removeProperty('clip-path');
    }
    concealed.clear();
    // Przywracamy dokładnie poprzednią wartość inline, o ile nadal jest nasza. Okienko, które przy zamknięciu
    // zdejmuje blokadę przez style inline, nadpisało już naszą wartość (wtedy nic nie robimy); blokada z klasy
    // znika razem z klasą, a wartość inline sprzed obsługi należała do strony.
    for (const [el, [v, p]] of unlocked) {
      if (el.style.getPropertyValue('overflow') !== 'auto' || el.style.getPropertyPriority('overflow') !== 'important') continue;
      if (v) el.style.setProperty('overflow', v, p); else el.style.removeProperty('overflow');
    }
    unlocked.clear();
  }

  /** Pełnoekranowe przyciemnienia obok okienka (osobne elementy, bez tekstu). */
  function backdropsOf(root) {
    const out = [];
    for (let n = root, d = 0; n && n !== document.body && d < 6; n = parentOf(n), d++) {
      const p = parentOf(n);
      if (!p || !p.children) break;
      for (const s of p.children) {
        if (s === n || (s.id && s.id.startsWith('ccr-')) || /^(SCRIPT|STYLE|LINK|META)$/.test(s.tagName)) continue;
        if (getComputedStyle(s).position !== 'fixed') continue;
        const r = s.getBoundingClientRect();
        if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && !(s.innerText || '').trim()) out.push(s);
      }
    }
    return out;
  }

  function concealBanner(root) {
    conceal(root);
    try { backdropsOf(root).forEach(conceal); } catch (e) { /* ignore */ }
  }

  // Okienka znanych CMP ukrywamy już w chwili pojawienia się w DOM (przed pierwszym odmalowaniem),
  // a podczas obsługi także nowe okna dialogowe (np. panel ustawień). Gdy obsługa nie ruszy — wracają na ekran.
  let earlySel = null;
  function earlySelector() {
    if (earlySel !== null) return earlySel;
    const ok = [];
    for (const c of R.CMPS) for (const s of [c.detect, c.panel]) {
      if (!s) continue;
      try { document.querySelector(s); ok.push(s); } catch (e) { /* niepoprawny selektor */ }
    }
    return (earlySel = ok.join(', '));
  }
  const BUSY_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog';

  function concealEarly(mutations) {
    if (!hideOn() || attempts >= MAX_ATTEMPTS) return;
    const sel = earlySelector();
    if (!sel) return;
    let hit = false;
    // podczas obsługi nowe pływające okna (np. panel ustawień bez roli dialog) też ukrywamy od razu
    const floatingNew = el => {
      try { return getComputedStyle(el).position === 'fixed' && !(el.id && el.id.startsWith('ccr-')); } catch (e) { return false; }
    };
    const check = el => {
      if (el.nodeType !== 1) return;
      if (el.matches(sel) || (busy && (el.matches(BUSY_SEL) || floatingNew(el)))) { conceal(el); hit = true; return; }
      if (busy) for (const c of el.children) if (floatingNew(c)) { conceal(c); hit = true; }
      if (el.firstElementChild) for (const m of el.querySelectorAll(sel)) { conceal(m); hit = true; }
    };
    try {
      for (const m of mutations) {
        if (m.type === 'childList') m.addedNodes.forEach(check);
        else if (m.type === 'attributes' && m.target.nodeType === 1 && m.target.matches(sel)) { conceal(m.target); hit = true; }
      }
    } catch (e) { /* ignore */ }
    if (hit && !busy) {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => { if (!busy) reveal(); }, 3000);
    }
  }

  // ======================================================================
  // Przełączniki kategorii
  // ======================================================================
  // [data-ccr-toggle] — przełączniki rozpoznane po wyglądzie (visualToggles), oznaczone przy pierwszym znalezieniu
  const TOGGLE_SEL = 'input[type="checkbox"], [role="switch"], [role="checkbox"], [data-ccr-toggle]';
  const VIS = 'data-ccr-toggle';

  function getToggles(root) {
    let list = deepQueryAll(root, TOGGLE_SEL);
    if (!list.some(el => !el.hasAttribute(VIS))) list = list.concat(visualToggles(root).filter(el => !list.includes(el)));
    // usuń zagnieżdżone (np. input wewnątrz [role=switch]); przodkowie zamiast porównań każdy z każdym (setki vendorów)
    const set = new Set(list);
    return list.filter(el => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    }).slice(0, 3000);
  }

  // ----------------------------------------------------------------------
  // Przełączniki rysowane samym CSS-em: podłużny „tor” z okrągłą „gałką”, bez input/role/aria (np. oponeo.pl).
  // Rozpoznajemy je po kształcie, a stan po położeniu gałki (po prawej = włączony).
  // ----------------------------------------------------------------------
  function knobOf(track) {
    const tr = track.getBoundingClientRect();
    for (const k of track.querySelectorAll('*')) {
      const r = k.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || Math.abs(r.width - r.height) > 3) continue;
      if (r.width > tr.height + 2 || r.width >= tr.width * 0.75) continue;
      if (parseFloat(getComputedStyle(k).borderTopLeftRadius) >= r.width * 0.3) return k;
    }
    return null;
  }

  function visualToggles(root) {
    const out = [];
    let all;
    try { all = root.querySelectorAll('div, span, button, label, a, i, em'); } catch (e) { return out; }
    if (!all.length || all.length > 4000) return out;
    for (const el of all) {
      if (el.hasAttribute(VIS)) { out.push(el); continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.width > 90 || r.height < 10 || r.height > 44) continue;
      if (r.width < r.height * 1.3 || r.width > r.height * 3.5) continue;
      if ((el.innerText || '').trim() || el.querySelector('input, [role="switch"], [role="checkbox"]')) continue;
      if (!knobOf(el)) continue;
      if (getComputedStyle(el).cursor !== 'pointer' && !el.closest('button, label, a, [onclick], [tabindex]')) continue;
      el.setAttribute(VIS, '');
      out.push(el);
    }
    return out;
  }

  function visualState(track) {
    const k = knobOf(track);
    if (!k) return false;
    const tr = track.getBoundingClientRect(), kr = k.getBoundingClientRect();
    return kr.left + kr.width / 2 > tr.left + tr.width / 2;
  }

  function toggleState(el) {
    if (el.hasAttribute(VIS)) return visualState(el);
    if (el.tagName === 'INPUT') return el.checked;
    return el.getAttribute('aria-checked') === 'true';
  }

  function toggleDisabled(el) {
    return el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true';
  }

  function classifyText(t) {
    if (!t) return null;
    for (const k of R.CAT_ORDER) if (any(t, R.CAT[k])) return k;
    return null;
  }

  function headingIn(el) {
    const h = el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"],legend,summary,dt,th,strong,b,[class*="title" i],[class*="name" i],[class*="header" i]');
    return h ? norm(h.innerText || h.textContent).slice(0, 160) : '';
  }

  let toggleCounts = null; // pamięć podręczna na czas jednego przejścia po przełącznikach
  function countToggles(el) {
    if (toggleCounts && toggleCounts.has(el)) return toggleCounts.get(el);
    let n = 0;
    try { n = el.querySelectorAll(TOGGLE_SEL).length; } catch { /* ignore */ }
    if (toggleCounts) toggleCounts.set(el, n);
    return n;
  }

  /** Ustala kategorię przełącznika na podstawie etykiety i najbliższego kontekstu. */
  function toggleCategory(el) {
    const parts = [];
    const rn = el.getRootNode();
    const al = el.getAttribute('aria-label');
    if (al) parts.push(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) {
      const n = rn.getElementById ? rn.getElementById(id) : document.getElementById(id);
      if (n) parts.push(n.innerText || n.textContent);
    }
    if (el.id && rn.querySelector) {
      try {
        const l = rn.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(l.innerText || l.textContent);
      } catch (e) { /* ignore */ }
    }
    const wrapLabel = el.closest && el.closest('label');
    if (wrapLabel) parts.push(wrapLabel.innerText || wrapLabel.textContent);
    if (el.name) parts.push(el.name.replace(/[_-]/g, ' '));
    if (el.id) parts.push(el.id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '));

    const short = norm(parts.join(' ')).slice(0, 200);
    if (any(short, R.TOGGLE_SKIP)) return 'skip';
    if (any(short, R.CAT.legitimateInterest)) return 'legitimateInterest';

    let cat = classifyText(short);
    if (cat) return cat;

    // wiersz: najwyższy przodek, który nadal zawiera tylko ten jeden przełącznik
    let row = el, p = parentOf(el), climbed = 0;
    while (p && p !== document.body && climbed++ < 12) {
      if (countToggles(p) > 1) break;
      row = p; p = parentOf(p);
    }
    const head = headingIn(row);
    cat = classifyText(head);
    if (cat) return cat;
    const rowText = norm(row.innerText || row.textContent).slice(0, 250);
    cat = classifyText(rowText);
    if (cat) return cat;

    // wiersz z kilkoma przełącznikami (np. TCF: "Zgoda" + "Uzasadniony interes") — nagłówek wiersza
    for (let q = p, k = 0; q && q !== document.body && k < 4 && countToggles(q) <= 3; q = parentOf(q), k++) {
      cat = classifyText(headingIn(q));
      if (cat) return cat;
    }

    // kontekst wyżej: nagłówki sekcji, klasy/id kontenerów (np. lista vendorów)
    let n = p, d = 0;
    while (n && n !== document.body && d++ < 8) {
      const idc = norm(`${n.id || ''} ${typeof n.className === 'string' ? n.className : ''}`);
      if (/vendor|partner|dostawc/.test(idc)) return 'thirdParty';
      n = parentOf(n);
    }
    return 'other';
  }

  /**
   * Ustawia przełączniki partiami: najpierw klika wszystkie bez czekania, potem jedna krótka pauza
   * (frameworki aktualizujące stan asynchronicznie) i poprawki tylko tam, gdzie stan się nie zmienił:
   * kliknięcie etykiety, a w ostateczności ustawienie `checked` i zdarzenia input/change.
   * Wcześniej każdy przełącznik czekał 40 ms — przy setkach dostawców to kilka sekund.
   */
  async function setToggles(items) {
    // Przełącznik rysowany CSS-em, którego wygląd (klasa/styl toru lub gałki) zmienił się po kliknięciu, uznajemy
    // za przełączony, nawet jeśli gałka jeszcze jedzie (wolna animacja, karta w tle) — ponowne kliknięcie cofnęłoby zmianę.
    const looks = el => { const k = knobOf(el); return [el, k].map(n => n ? `${n.className}|${n.getAttribute('style')}` : '').join('#'); };
    const before = new Map(items.filter(([el]) => el.hasAttribute(VIS)).map(([el]) => [el, looks(el)]));
    const assumed = new Set();
    const wrong = () => items.filter(([el, want]) => el.isConnected && !assumed.has(el) && toggleState(el) !== want);
    // co ~50 ms oddajemy sterowanie, żeby limit czasu obsługi (runHandle) mógł przerwać pętlę na wolnej stronie
    let lastYield = performance.now();
    const breathe = async () => {
      if (performance.now() - lastYield > 50) { await yieldNow(); lastYield = performance.now(); }
      checkAbort();
    };
    let todo = wrong();
    const changed = new Set(todo.map(([el]) => el));
    // przełączniki rysowane CSS-em: gałka przesuwa się z animacją — stan czytelny dopiero po jej końcu
    const settle = list => sleep(list.some(([el]) => el.hasAttribute(VIS)) ? 400 : 60);
    for (const [el] of todo) { await breathe(); el.click(); }
    if (todo.length) await settle(todo);
    for (const [el] of todo) if (before.has(el) && looks(el) !== before.get(el)) assumed.add(el);
    // wizualne: jedno ponowne kliknięcie tych, które nadal są źle i nie zmieniły wyglądu (etykiety i `checked` ich nie dotyczą)
    const vis = wrong().filter(([el]) => el.hasAttribute(VIS));
    for (const [el] of vis) { await breathe(); el.click(); }
    if (vis.length) await settle(vis);
    todo = wrong().filter(([el]) => !el.hasAttribute(VIS));
    for (const [el] of todo) {
      await breathe();
      const rn = el.getRootNode();
      const lab = (el.closest && el.closest('label')) || (el.id && rn.querySelector && rn.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) lab.click();
    }
    if (todo.length) await sleep(60);
    for (const [el, want] of wrong()) {
      if (el.tagName !== 'INPUT') continue;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;
      setter.call(el, want);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const still = new Set(wrong().map(([el]) => el));
    return [...changed].filter(el => !still.has(el)).length;
  }

  /** Ustawia wszystkie przełączniki w panelu. Zwraca {found, changed, cats}. */
  async function applyToggles(panel, prefs) {
    const toggles = getToggles(panel);
    const res = { found: 0, changed: 0, cats: {} };
    // najpierw kategorie (bez klikania: układ strony się nie zmienia), potem kliknięcia
    toggleCounts = new WeakMap();
    let plan;
    try {
      plan = toggles.filter(t => !toggleDisabled(t)).map(t => [t, toggleCategory(t)]).filter(([, cat]) => cat !== 'skip');
    } finally { toggleCounts = null; }
    const items = plan.map(([t, cat]) => {
      const want = cat === 'necessary' ? true : !!prefs[cat];
      res.found++;
      res.cats[cat] = want;
      return [t, want];
    });
    res.changed = await setToggles(items);
    log('toggles', res);
    return res;
  }

  /** Pary przycisków "zgadzam się / nie zgadzam się" (np. Didomi) — wybiera właściwy. */
  async function applyButtonPairs(panel, prefs) {
    let n = 0;
    const btns = deepQueryAll(panel, '[role="radio"], button[aria-pressed], [role="button"][aria-pressed]');
    const groups = new Map();
    for (const b of btns) {
      const p = parentOf(b);
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(b);
    }
    for (const [parent, list] of groups) {
      if (list.length !== 2) continue;
      const cls = list.map(b => classifyButton(labelOf(b)));
      const yes = list[cls.indexOf('accept')], no = list[cls.indexOf('reject')];
      if (!yes || !no) continue;
      let row = parent, d = 0;
      while (row && d++ < 6 && !headingIn(row)) row = parentOf(row);
      const cat = (row && classifyText(headingIn(row))) || 'other';
      const want = cat === 'necessary' ? true : !!prefs[cat];
      const target = want ? yes : no;
      const pressed = target.getAttribute('aria-pressed') === 'true' || target.getAttribute('aria-checked') === 'true';
      if (!pressed) { target.click(); n++; }
    }
    if (n) await sleep(60);
    return n;
  }

  /** Zakładki/przyciski "Uzasadniony interes" + "Sprzeciw wobec wszystkich". */
  async function handleLegitimateInterest(panel, prefs, result) {
    if (prefs.legitimateInterest) return;
    const cands = deepQueryAll(panel, 'button, [role="tab"], [role="button"], a').filter(e => isVisible(e) && !navigatesAway(e));
    const tabs = cands.filter(e => {
      if (!norm(e.innerText || '')) return false; // zakładka ma widoczny tekst; ikony z aria-label (np. „Opis: …”) to nie zakładki
      const t = labelOf(e);
      return t.length < 60 && any(t, R.CAT.legitimateInterest) && !any(t, R.BTN_OBJECT_ALL);
    });
    for (const tab of tabs.slice(0, 2)) {
      await click(tab);
      await sleep(200);
      const r = await applyToggles(panel, prefs);
      result.found += r.found; result.changed += r.changed;
    }
    const objectAll = deepQueryAll(panel, 'button, [role="button"]').filter(e => {
      const t = labelOf(e);
      return isVisible(e) && t.length < 60 && any(t, R.BTN_OBJECT_ALL);
    });
    for (const b of objectAll.slice(0, 2)) { await click(b); result.found++; result.changed++; }
  }

  // ======================================================================
  // Wykrywanie banerów
  // ======================================================================
  const CAND_SEL = [
    'cookie', 'consent', 'gdpr', 'rodo', 'cmp', 'privacy', 'ciastecz', 'ciastk', 'tracking', 'banner', 'notice'
  ].flatMap(w => [`[id*="${w}" i]`, `[class*="${w}" i]`])
    .concat(['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog[open]']).join(',');

  /** Kontener całej strony (np. powłoka aplikacji GitHuba), w którym „Manage cookies” to tylko link w stopce. */
  function isPageShell(el) {
    try {
      if (el.querySelector('main, [role="main"]')) return true;
      return !!(el.querySelector('nav, [role="navigation"]') && el.querySelector('footer, [role="contentinfo"]') &&
        el.querySelector('header, [role="banner"]'));
    } catch { return false; }
  }

  // ----------------------------------------------------------------------
  // Strony i okna płatności (bramki, kasy sklepów) nigdy nie są okienkiem zgody: nie wykrywamy ich heurystycznie,
  // nie ukrywamy, nie pytamy o „zgodę albo płać” i nie proponujemy zgłoszenia. Znane CMP (reguły) działają dalej.
  // ----------------------------------------------------------------------
  const PAY_HOST_RE = /(^|\.)(przelewy24\.pl|payu\.(com|pl)|tpay\.com|paynow\.pl|dotpay\.pl|blik\.com|autopay\.(pl|eu)|bluemedia\.pl|imoje\.pl|paypal\.com|stripe\.com|checkout\.com|adyen\.com|klarna\.com|paypo\.pl|revolut\.com|mollie\.com|braintreegateway\.com|worldpay\.com|sumup\.com|paysafe\.com|skrill\.com|trustly\.com|sofort\.com|cardinalcommerce\.com|pay\.google\.com)$/;
  const PAY_SUB_RE = /^(pay|pays|payment|payments|checkout|platnosc|platnosci|3ds|3dsecure|acs)\./;
  const CARD_SEL = 'input[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="cvv" i], input[name*="cvc" i], ' +
    'iframe[src*="stripe.com"], iframe[src*="adyen"], iframe[src*="braintree"], iframe[src*="przelewy24"], iframe[src*="payu"], iframe[src*="tpay"], iframe[name*="card" i]';

  function onPaymentHost() {
    return [location.hostname, topHost].some(h => h && (PAY_HOST_RE.test(h.toLowerCase()) || PAY_SUB_RE.test(h.toLowerCase())));
  }

  function looksLikePayment(el, text) {
    try { if (el && el.querySelector && el.querySelector(CARD_SEL)) return true; } catch (e) { /* ignore */ }
    const t = text != null ? text : norm(el ? deepText(el) : '');
    let methods = 0;
    for (const re of R.PAY_METHOD) if (re.test(t)) methods++;
    return methods >= 3 || (methods >= 1 && any(t, R.TXT_CHECKOUT));
  }

  /** Okienko mówi o zgodzie na cookies/śledzenie (a nie np. o regulaminie płatności czy danych osobowych w ogóle). */
  function consentEvidence(t) {
    return any(t, R.TXT_STRONG) ||
      (/zgod|consent|einwillig|zustimm|consentement|consentimiento/.test(t) && /partner|reklam|advertis|werbung|publicit|vendor|dostawc/.test(t));
  }

  function hasButtons(b) {
    return b.reject.length + b.accept.length + b.settings.length + b.save.length > 0;
  }

  // ----------------------------------------------------------------------
  // Wykrywanie od treści: nazwy klas (Tailwind, CSS-in-JS) i głębokość w DOM są dowolne, ale okienko zgody
  // zawsze mówi o cookies/prywatności i „pływa” nad stroną. Szukamy więc tekstu, a od niego w górę drzewa
  // najbliższego pływającego kontenera (fixed/sticky/dialog).
  // ----------------------------------------------------------------------
  const HINT_RE = /cookie|ciastecz|ciasteczk|\brodo\b|gdpr|rgpd|dsgvo|prywatno|privacy|consent|zgod[ayęe]|datenschutz|einwillig|consentement|privacidad|tracking|tracker/i;
  const HINT_SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|OPTION|TEXTAREA)$/;

  function textAnchoredBoxes(maxHits = 150) {
    const floatCache = new Map();
    const floating = el => {
      if (!floatCache.has(el)) {
        let f = false;
        try {
          const pos = getComputedStyle(el).position;
          f = pos === 'fixed' || pos === 'sticky' || el.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
        } catch (e) { /* ignore */ }
        floatCache.set(el, f);
      }
      return floatCache.get(el);
    };
    const boxOf = start => {
      let inner = null;
      for (let n = start, d = 0; n && n !== document.body && n !== document.documentElement && d < 30; n = parentOf(n), d++) {
        if (n.id && n.id.startsWith('ccr-')) return null;
        if (floating(n)) { inner = n; break; }
      }
      if (!inner) return null;
      // pływające opakowania wokół (np. pełnoekranowe przyciemnienie) — najbardziej zewnętrzne, które nie dodaje treści
      const len = (inner.innerText || '').length;
      let best = inner;
      for (let n = parentOf(inner), d = 0; n && n !== document.body && n !== document.documentElement && d < 10; n = parentOf(n), d++) {
        if (!floating(n)) continue;
        if ((n.innerText || '').length > len * 1.5 + 200) break;
        best = n;
      }
      return best;
    };
    const out = new Set(), seen = new Set();
    const roots = document.body ? [document.body, ...shadowHosts(document.body).map(h => h.shadowRoot)] : [];
    let hits = 0;
    for (const r of roots) {
      if (!r) continue;
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t && hits < maxHits; t = w.nextNode()) {
        const v = t.nodeValue;
        if (!v || v.length < 4 || !HINT_RE.test(v)) continue;
        const p = t.parentElement || (t.parentNode && t.parentNode.host);
        if (!p || seen.has(p) || HINT_SKIP.test(p.tagName)) continue;
        seen.add(p); hits++;
        const box = boxOf(p);
        if (box) out.add(box);
      }
    }
    return [...out];
  }

  function findBanners() {
    const out = [];
    for (const cmp of R.CMPS) {
      for (const el of deepQueryAll(document, cmp.detect)) {
        if (isShown(el) && !out.some(o => o.root === el || containsDeep(o.root, el))) out.push({ root: el, cmp });
      }
    }
    if (out.length) return out;
    if (onPaymentHost()) return out; // bramka płatności — tylko znane CMP

    const cands = new Set(deepQueryAll(document, CAND_SEL));
    if (document.body) {
      for (const el of document.body.querySelectorAll(':scope > *, :scope > * > *')) cands.add(el);
      for (const h of shadowHosts(document.body)) cands.add(h);
    }
    try { for (const el of textAnchoredBoxes()) cands.add(el); } catch (e) { log('textAnchoredBoxes', e); }
    const good = [];
    for (const el of cands) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.id && el.id.startsWith('ccr-')) continue;
      if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|IFRAME|HEAD)$/.test(el.tagName)) continue;
      if (!isVisible(el)) continue;
      const text = norm(deepText(el));
      if (text.length < 20 || text.length > 12000) continue;
      const score = cookieScore(text);
      if (score < 3) continue;
      if (looksLikePayment(el, text)) continue;
      const floating = isFloating(el);
      const staticOk = score >= 5 && text.length < 2000 && parentOf(el) === document.body;
      if (!floating && !staticOk) continue;
      if (isPageShell(el)) continue;
      if (!hasButtons(analyze(el))) continue;
      good.push(el);
    }
    // zostaw najbardziej zewnętrzne
    const roots = good.filter(el => !good.some(o => o !== el && containsDeep(o, el)));
    for (const r of roots) out.push({ root: r, cmp: null });

    // iframe CMP: cały dokument to baner
    if (!out.length && !IS_TOP && document.body) {
      const text = norm(deepText(document.body));
      if (text.length < 8000 && cookieScore(text) >= 3 && hasButtons(analyze(document.body))) {
        out.push({ root: document.body, cmp: null });
      }
    }
    return out;
  }

  function findPanel(root, cmp) {
    const cands = [];
    if (cmp && cmp.panel) cands.push(...deepQueryAll(document, cmp.panel));
    cands.push(root);
    for (const { root: r } of findBanners()) cands.push(r);
    cands.push(...deepQueryAll(document, '[role="dialog"], [aria-modal="true"], dialog[open]'));
    try { cands.push(...textAnchoredBoxes()); } catch (e) { /* ignore */ }
    let best = null, bestN = 0;
    const shown = [...new Set(cands)].filter(c => isShown(c));
    for (const c of shown) {
      const n = getToggles(c).filter(t => !toggleDisabled(t)).length;
      if (n > bestN) { best = c; bestN = n; }
    }
    if (best) return best;
    // Ustawienia otworzyły osobne okno bez rozpoznawalnych przełączników, ale z „Zapisz”/„Odrzuć” —
    // to też panel (nie czekamy na przełączniki do końca limitu, „Odrzuć wszystkie” w nim zadziała)
    for (const c of shown) {
      if (c === root || containsDeep(c, root) || containsDeep(root, c)) continue;
      const b = analyze(c, cmp);
      if (b.save.length || b.reject.length) return c;
    }
    return null;
  }

  // ======================================================================
  // Komunikacja
  // ======================================================================
  function pageApi(action, payload, timeout = 2000) {
    return new Promise(resolve => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = e => {
        const d = e.data;
        if (e.source === window && d && d.tag === PAGE_TAG && d.dir === 'res' && d.id === id) {
          window.removeEventListener('message', onMsg);
          resolve(d.result);
        }
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ tag: PAGE_TAG, dir: 'req', id, action, payload }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, timeout);
    });
  }

  function send(msg) {
    return api.runtime.sendMessage(msg).catch(() => null);
  }

  function report(method, cmp, extra = {}) {
    log('handled', method, cmp && cmp.name, extra);
    send({ type: 'handled', method, cmp: cmp ? cmp.name : 'heurystyka', frameHost: location.hostname, ...extra });
  }

  // ======================================================================
  // Zgłaszanie okienek, których nie umiemy obsłużyć
  // ======================================================================
  const clean = (s, n) => String(s || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, n);
  const oneLine = (s, n) => clean(s, 4 * n).replace(/\n/g, ' ').slice(0, n);

  function toggleLabel(el) {
    const al = el.getAttribute('aria-label') || '';
    let row = el, p = parentOf(el), k = 0;
    while (p && p !== document.body && k++ < 8 && countToggles(p) <= 1) { row = p; p = parentOf(p); }
    const t = oneLine(row.innerText || row.textContent, 100);
    if (!t) return oneLine(al, 100);
    return oneLine(al && !t.toLowerCase().includes(al.toLowerCase()) ? `${al} — ${t}` : t, 100);
  }

  /** Skrót struktury DOM okienka: tagi, id, klasy, role — bez treści. */
  function outline(root, maxNodes = 160, maxDepth = 7) {
    const out = [];
    const walk = (el, d) => {
      if (out.length >= maxNodes || d > maxDepth || !el.tagName) return;
      if (/^(script|style|noscript|template|svg|path|link|meta)$/i.test(el.tagName)) return;
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + oneLine(el.id, 40);
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += '.' + cls.map(c => oneLine(c, 30)).join('.');
      for (const a of ['role', 'aria-modal', 'type', 'aria-checked']) {
        if (el.hasAttribute(a)) s += `[${a}=${oneLine(el.getAttribute(a), 20)}]`;
      }
      if (el.shadowRoot) s += ' (shadow)';
      out.push('  '.repeat(d) + s);
      for (const c of [...(el.shadowRoot ? el.shadowRoot.children : []), ...el.children]) walk(c, d + 1);
    };
    walk(root, 0);
    if (out.length >= maxNodes) out.push('…');
    return out.join('\n').slice(0, 6000);
  }

  function browserName() {
    const ua = navigator.userAgent;
    for (const [k, name] of [['Edg', 'Edge'], ['OPR', 'Opera'], ['CCleaner', 'CCleaner'], ['Firefox', 'Firefox'], ['Chrome', 'Chrome']]) {
      const m = new RegExp(k + '/(\\d+)').exec(ua);
      if (m) return `${name} ${m[1]}`;
    }
    return 'inna';
  }

  /** Dane zgłoszenia. Adres strony uzupełnia background (z adresu karty, bez parametrów). */
  function collectReport(root, panel, cmp, reason) {
    const scope = (panel && isShown(panel)) ? panel : root;
    const buttons = scope ? actionables(scope).filter(isVisible).slice(0, 40).map(el => ({
      t: oneLine(el.tagName === 'INPUT' ? el.value : (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title')), 100),
      c: classifyButton(labelOf(el))
    })).filter(b => b.t) : [];
    const toggles = scope ? getToggles(scope).slice(0, 60).map(el => {
      const cat = toggleCategory(el);
      return { t: toggleLabel(el), on: toggleState(el), dis: !!toggleDisabled(el), cat: cat === 'skip' ? null : cat };
    }) : [];
    return {
      v: 1,
      ext: api.runtime.getManifest().version,
      browser: browserName(),
      reason,
      cmp: cmp ? cmp.name : '',
      page: { frameHost: location.hostname, lang: (document.documentElement.lang || '').slice(0, 20), top: IS_TOP },
      blocking: scope ? !!isBlocking(scope) : false,
      text: scope ? clean(deepText(scope), 5000) : '',
      buttons,
      toggles,
      outline: scope ? outline(scope) : ''
    };
  }

  async function offerReport(root, panel, cmp, reason) {
    if (reported || !settings.reportUnsupported) return;
    reported = true;
    await sleep(2000); // okienko mogło zniknąć z opóźnieniem — wtedy to nie jest problem
    if (!isShown(root) && !(panel && isShown(panel))) { reported = false; return; }
    let data;
    try { data = collectReport(root, panel, cmp, reason); } catch (e) { log('report: błąd zbierania', e); return; }
    log('nieobsłużone okienko', reason, data);
    send({ type: 'unhandled', data });
  }

  /** Okienko wyglądające na zgodę cookie, w którym nie rozpoznaliśmy żadnego przycisku. */
  function findUnrecognized(minScore = 6) {
    let best = null, bestScore = 0;
    if (onPaymentHost()) return null;
    const cands = new Set(deepQueryAll(document, CAND_SEL));
    if (document.body) for (const el of document.body.querySelectorAll(':scope > *, :scope > * > *')) cands.add(el);
    try { for (const el of textAnchoredBoxes()) cands.add(el); } catch (e) { /* ignore */ }
    for (const el of cands) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.id && el.id.startsWith('ccr-')) continue;
      if (!isVisible(el) || !isFloating(el) || isPageShell(el)) continue;
      const text = norm(deepText(el));
      if (text.length < 40 || text.length > 4000) continue;
      const sc = cookieScore(text);
      if (sc < minScore) continue;
      if (looksLikePayment(el, text)) continue;
      if (!actionables(el).some(isVisible)) continue;
      if (sc > bestScore || (sc === bestScore && best && containsDeep(el, best))) { best = el; bestScore = sc; }
    }
    return best;
  }

  // ======================================================================
  // Obsługa banera
  // ======================================================================
  function summarizeCats(cats) {
    return Object.fromEntries(Object.entries(cats || {}).filter(([k]) => k !== 'necessary'));
  }

  async function tryApi(root, cmp, prefs) {
    if (!cmp || !cmp.api) return false;
    if (cmp.api === 'cookiebot') {
      const r = await pageApi('cookiebot', prefs);
      if (r && r.ok && await waitGone([root], 2000)) { report('api', cmp, { cats: prefs }); return true; }
    }
    if (cmp.api === 'usercentrics') {
      const list = await pageApi('usercentrics-list', {});
      if (list && list.ok && list.services && list.services.length) {
        const accept = [], reject = [];
        for (const s of list.services) {
          if (s.essential) { accept.push(s.id); continue; }
          const cat = classifyText(norm(`${s.category} ${s.name}`)) || 'other';
          (cat === 'necessary' || prefs[cat] ? accept : reject).push(s.id);
        }
        const r = await pageApi('usercentrics-apply', { accept, reject }, 4000);
        if (r && r.ok && await waitGone([root], 2500)) { report('api', cmp, { cats: prefs, rejected: reject.length }); return true; }
      }
    }
    return false;
  }

  /** Ustawienie szczegółowe: przełączniki + "Zapisz". */
  async function tryGranular(root, cmp, b, prefs) {
    let panel = null;
    const inRoot = getToggles(root).filter(t => !toggleDisabled(t));
    if (inRoot.length && b.save.length) {
      panel = root;
    } else if (b.settings.length) {
      await click(b.settings[0]);
      panel = await waitFor(() => findPanel(root, cmp), 4000);
      if (panel) concealBanner(panel);
      if (!panel) {
        log('granular: brak panelu z przełącznikami');
        return { ok: false, opened: true };
      }
    } else {
      return { ok: false };
    }
    await sleep(150);
    // panel bywa wstawiany przed swoją zawartością — chwila na przełączniki
    if (!getToggles(panel).length) await waitFor(() => getToggles(panel).length, 600);
    const res = await applyToggles(panel, prefs);
    res.changed += await applyButtonPairs(panel, prefs);
    await handleLegitimateInterest(panel, prefs, res);
    if (!res.found) return { ok: false, opened: true, panel };

    let pb = analyze(panel, cmp);
    if (!pb.save.length) {
      // panel może się jeszcze pojawiać (animacja przezroczystości) — chwila na „Zapisz”, potem bez wymogu nieprzezroczystości
      await waitFor(() => analyze(panel, cmp).save.length, 1500);
      pb = analyze(panel, cmp);
      if (!pb.save.length && panel !== root) pb = analyze(panel, cmp, true);
    }
    const save = pb.save[0] || (cmp && cmp.save && deepQueryAll(document, cmp.save).find(isVisible));
    if (!save) return { ok: false, opened: true, panel };
    const info = { cats: summarizeCats(res.cats), changed: res.changed };
    if (!IS_TOP) report('granular', cmp, info); // ramka CMP może zniknąć razem z banerem
    await click(save);
    if (await waitGone([root, panel], 3000)) { if (IS_TOP) report('granular', cmp, info); return { ok: true }; }
    return { ok: false, opened: true, panel };
  }

  async function tryReject(root, cmp, panel) {
    for (const scope of [panel, root].filter(Boolean)) {
      if (!isShown(scope)) continue;
      let b = analyze(scope, cmp);
      if (!b.reject.length && scope === panel && panel !== root) b = analyze(scope, cmp, true); // panel otwarty przez nas, jeszcze się pojawia
      if (b.reject.length) {
        if (!IS_TOP) report('reject', cmp);
        await click(b.reject[0]);
        if (await waitGone([root, panel], 3000)) { if (IS_TOP) report('reject', cmp); return true; }
      }
    }
    return false;
  }

  function hideBanner(root) {
    root.style.setProperty('display', 'none', 'important');
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
    }
  }

  async function handleWall(root, cmp, b, kind) {
    if (wallAsked) return;
    wallAsked = true;
    const resp = await send({ type: 'wall', kind, cmp: cmp ? cmp.name : null });
    const decision = resp && resp.decision;
    log('wall decision', decision);
    if (decision === 'accept') {
      const acc = analyze(root, cmp).accept[0] || b.accept[0];
      if (acc) { report('wall-accept', cmp, { kind }); await click(acc); }
    }
    // 'decline' → background ewentualnie zamyka kartę; w przeciwnym razie nic nie robimy
  }

  async function handle(root, cmp) {
    const prefs = settings.categories;
    const onlyNecessary = globalThis.CCR.OPTIONAL_KEYS.every(k => !prefs[k]);
    log('baner', cmp ? cmp.name : 'heurystyka', root);

    if (await tryApi(root, cmp, prefs)) return;

    let b = analyze(root, cmp);
    let panel = null;

    // 1) wszystko poza niezbędnymi wyłączone → najprościej "Odrzuć wszystkie"
    if (onlyNecessary && b.reject.length) {
      if (await tryReject(root, cmp, null)) return;
    }

    // 2) ustawienie szczegółowe
    if (settings.granular || onlyNecessary) {
      const g = await tryGranular(root, cmp, b, prefs);
      if (g.ok) return;
      panel = g.panel || null;
      if (g.opened && !isShown(root) && !panel) {
        // panel ustawień zastąpił baner, ale nie dało się go obsłużyć
        panel = findBanners().map(x => x.root)[0] || null;
      }
    }

    // 3) fallback: odrzuć wszystkie (w panelu lub na banerze)
    if (settings.fallback === 'reject' || onlyNecessary) {
      if (await tryReject(root, cmp, panel)) return;
    } else if (b.reject.length || b.settings.length) {
      log('fallback=none — zostawiam baner');
      reveal();
      return 'left';
    }

    // 4) brak opcji odrzucenia → ściana cookies / „zgoda albo płać” / baner informacyjny
    //    tu decyduje użytkownik albo okienko zostaje — wraca na ekran (isBlocking też potrzebuje go widocznego)
    reveal();
    const scope = (panel && isVisible(panel)) ? panel : root;
    b = analyze(scope, cmp);
    const text = norm(deepText(scope));
    // Pytanie o „zgodę albo płać”, ścianę albo ukrycie banera tylko dla okienka, które wprost mówi o zgodzie
    // na cookies/śledzenie — nigdy dla okna płatności (bramka, kasa sklepu), regulaminu czy formularza.
    if (onPaymentHost() || looksLikePayment(scope, text) || (!cmp && !consentEvidence(text))) {
      log('to nie okienko zgody (płatność / brak mowy o cookies) — zostawiam');
      return 'left';
    }
    if (!b.accept.length) {
      log('brak przycisków do obsłużenia');
      offerReport(root, panel, cmp, (b.reject.length || b.settings.length) ? 'reject-failed' : 'no-accept');
      return 'offered';
    }
    const pay = b.pay.length > 0 || any(text, R.TXT_PAY);
    if (pay) { await handleWall(scope, cmp, b, 'pay'); return 'left'; }
    if (b.reject.length || b.settings.length) { // jest wybór, ale nie zadziałał — nie akceptujemy na ślepo
      offerReport(root, panel, cmp, 'reject-failed');
      return 'offered';
    }
    if (isBlocking(scope)) { await handleWall(scope, cmp, b, 'cookiewall'); return 'left'; }

    // baner informacyjny (np. "Ta strona używa cookies. OK")
    if (settings.infoBanner === 'hide') { hideBanner(scope); report('hidden', cmp); }
    else if (settings.infoBanner === 'accept') { report('info-accept', cmp); await click(b.accept[0]); }
  }

  async function scan() {
    if (busy || attempts >= MAX_ATTEMPTS || !settings) return;
    let banners;
    try { banners = findBanners(); } catch (e) { log('scan error', e); return; }
    if (!banners.length && !reported && settings.reportUnsupported && Date.now() - startedAt > 5000 && unrecognizedChecks < 3) {
      unrecognizedChecks++;
      const el = findUnrecognized();
      if (el) offerReport(el, null, null, 'unrecognized');
    }
    for (const { root, cmp } of banners) {
      if (handledRoots.has(root)) continue;
      handledRoots.add(root);
      busy = true; attempts++; aborted = false;
      concealBanner(root);
      let result;
      try { result = await runHandle(root, cmp); } finally { busy = false; reveal(); }
      if (result !== 'left' && result !== 'offered') checkStillShown(root, cmp, result);
      scheduleScan(800);
      break;
    }
  }

  /** handle() z limitem czasu: po jego przekroczeniu przerywa obsługę (kolejne kliknięcia rzucają wyjątek). */
  async function runHandle(root, cmp) {
    let timer;
    pageJankMs = 0;
    handleT0 = performance.now();
    const timeout = new Promise(r => { timer = setInterval(() => { if (overDeadline()) r('timeout'); }, 250); });
    const run = handle(root, cmp).catch(e => { log('handle error', e); return 'error'; });
    const result = await Promise.race([run, timeout]);
    clearInterval(timer);
    handleT0 = 0;
    if (result === 'timeout' && !aborted) { aborted = true; log('obsługa trwa zbyt długo — przerywam'); }
    return result;
  }

  /** Po obsłudze (także po błędzie lub przerwaniu) okienko nadal jest na ekranie → propozycja zgłoszenia. */
  async function checkStillShown(root, cmp, result) {
    await sleep(1500);
    if (!root.isConnected || !isShown(root)) return;
    log('okienko nadal widoczne po obsłudze', result);
    offerReport(root, null, cmp, 'reject-failed');
  }

  // przepustnica, nie odkładanie: na stronach, które ciągle zmieniają DOM (reklamy), skan nie może czekać w nieskończoność
  let scanDue = 0;
  function scheduleScan(ms = 300) {
    const due = Date.now() + ms;
    if (scanTimer && scanDue <= due) return;
    clearTimeout(scanTimer);
    scanDue = due;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, ms);
  }

  function startObserving() {
    startedAt = Date.now();
    scheduleScan(200);
    observer = new MutationObserver(muts => { concealEarly(muts); scheduleScan(250); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    setTimeout(() => { observer && observer.disconnect(); observer = null; }, SCAN_WINDOW_MS);
    // kilka dodatkowych skanów na wypadek wolno ładujących się CMP
    for (const t of [1500, 3500, 7000, 12000]) setTimeout(() => scheduleScan(0), t);
  }

  // ======================================================================
  // Wiadomości z backgroundu
  // ======================================================================
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'wall-prompt' && IS_TOP) {
      UI.askWall(msg).then(sendResponse);
      return true;
    }
    if (msg.type === 'report-prompt' && IS_TOP) {
      UI.askReport(msg).then(decision => send({ type: 'report-answer', decision }));
      return;
    }
    if (msg.type === 'collect-report') {
      // ręczne zgłoszenie z popupu: odpowiada ramka, w której jest okienko; ramka główna zawsze
      // (także bez znalezionego okienka i bez wczytanych ustawień — zgłoszenie ma dojść w każdym przypadku)
      let found = null, el = null;
      try { found = findBanners()[0] || null; el = found ? found.root : findUnrecognized(3); } catch (e) { log('collect-report', e); }
      let data = null;
      try { data = collectReport(el, null, found ? found.cmp : null, 'manual'); } catch (e) { log('collect-report', e); }
      if (el && data) { sendResponse({ data }); return; }
      if (IS_TOP && !msg.frames) { sendResponse({ data: data || collectReport(null, null, null, 'manual') }); return; }
      return;
    }
    if (msg.type === 'toast' && IS_TOP) {
      UI.toast(msg.html);
      return;
    }
    if (msg.type === 'rescan') {
      attempts = 0; wallAsked = false; reported = false; unrecognizedChecks = 0;
      init();
      sendResponse && sendResponse({ ok: true });
    }
  });

  // ======================================================================
  // Start
  // ======================================================================
  async function init() {
    const ctx = await send({ type: 'init' });
    if (!ctx || !ctx.settings) return;
    settings = ctx.settings;
    topHost = ctx.topHost;
    if (!settings.enabled || ctx.disabled) { log('wyłączone dla', topHost); return; }
    if (!observer) startObserving(); else scheduleScan(0);
  }
  init();
})();
