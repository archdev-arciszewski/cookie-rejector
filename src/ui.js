/* UI wstrzykiwane w stronę (tylko ramka główna): prompt "zgoda albo płać" i dyskretny toast.
 * Wszystko w zamkniętym Shadow DOM, żeby strona nie mogła tego zmienić ani podejrzeć. */
(function (g) {
  'use strict';

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .backdrop { position: fixed; inset: 0; background: rgba(10,12,16,.55); display: flex; align-items: center; justify-content: center; z-index: 2147483647; backdrop-filter: blur(2px); }
    .card { width: min(440px, calc(100vw - 32px)); background: #fff; color: #1d2330; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.35); padding: 22px 22px 18px; }
    .head { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; }
    .ico { width: 36px; height: 36px; flex: none; border-radius: 10px; background: #fff3e0; display: grid; place-items: center; font-size: 20px; }
    h2 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 650; }
    .host { font-size: 12px; color: #6b7280; margin-top: 2px; word-break: break-all; }
    p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: #374151; }
    .opts { margin-top: 14px; font-size: 13px; color: #374151; display: flex; align-items: center; gap: 8px; }
    .btns { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    button { flex: 1 1 160px; border: 0; border-radius: 10px; padding: 11px 14px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .yes { background: #1f6feb; color: #fff; }
    .yes:hover { background: #195fd0; }
    .no { background: #eef0f3; color: #1d2330; }
    .no:hover { background: #e2e5ea; }
    .brand { margin-top: 12px; font-size: 11px; color: #9ca3af; text-align: right; }
    .toast { position: fixed; right: 16px; bottom: 16px; max-width: min(380px, calc(100vw - 32px)); background: #1d2330; color: #f3f4f6; border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.4; box-shadow: 0 8px 30px rgba(0,0,0,.3); z-index: 2147483647; pointer-events: none; opacity: 0; transform: translateY(8px); transition: opacity .25s, transform .25s; }
    .toast.show { opacity: 1; transform: none; }
    .toast b { color: #fbbf24; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      .card { background: #1d2330; color: #f3f4f6; }
      p, .opts { color: #d1d5db; }
      .host { color: #9ca3af; }
      .no { background: #2d3443; color: #f3f4f6; }
      .no:hover { background: #374051; }
      .ico { background: #3a2e1a; }
    }
  `;

  function makeHost(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
    const root = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = STYLE;
    root.appendChild(st);
    (document.body || document.documentElement).appendChild(host);
    return { host, root };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Pokazuje prompt. Zwraca Promise<{decision:'accept'|'decline', remember:boolean}>. */
  function askWall({ kind, host, onDecline, remember }) {
    return new Promise(resolve => {
      const { host: el, root } = makeHost('ccr-wall-prompt');
      const pay = kind === 'pay';
      const title = pay ? 'Ta strona wymaga zgody na cookies albo płatności' : 'Ta strona wymaga akceptacji cookies';
      const body = pay
        ? 'Nie da się tu odrzucić śledzenia bez wykupienia subskrypcji („zgoda albo płać”). Czy zgodzić się na wszystkie cookies, żeby korzystać ze strony?'
        : 'Baner nie ma opcji odrzucenia ani ustawień — bez akceptacji strona prawdopodobnie nie będzie działać. Czy zaakceptować cookies?';
      const noLabel = onDecline === 'close' ? 'Nie — zamknij kartę' : 'Nie — zostaw';
      const wrap = document.createElement('div');
      wrap.className = 'backdrop';
      wrap.innerHTML = `
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="t">
          <div class="head"><div class="ico">🍪</div><div><h2 id="t">${esc(title)}</h2><div class="host">${esc(host || location.hostname)}</div></div></div>
          <p>${esc(body)}</p>
          <label class="opts"><input type="checkbox" id="rem" ${remember ? 'checked' : ''}> Zapamiętaj decyzję dla tej domeny</label>
          <div class="btns">
            <button class="no" id="no">${esc(noLabel)}</button>
            <button class="yes" id="yes">Tak — akceptuj</button>
          </div>
          <div class="brand">Cookie Rejector</div>
        </div>`;
      root.appendChild(wrap);
      const done = decision => {
        const rem = root.getElementById('rem').checked;
        el.remove();
        resolve({ decision, remember: rem });
      };
      root.getElementById('yes').addEventListener('click', () => done('accept'));
      root.getElementById('no').addEventListener('click', () => done('decline'));
      setTimeout(() => root.getElementById('yes').focus(), 50);
    });
  }

  let toastTimer = null;
  function toast(html, ms = 3800) {
    const { host, root } = makeHost('ccr-toast');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    root.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => host.remove(), 300); }, ms);
  }

  g.CCR_UI = { askWall, toast, esc };
})(globalThis);
