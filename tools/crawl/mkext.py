"""Kopia rozszerzenia do crawla: debug, log do sessionStorage (każda ramka), zgłoszenia na nieistniejący lokalny serwer.
python mkext.py <repo> <out>"""
import shutil, sys, os
repo, out = sys.argv[1], sys.argv[2]
if os.path.exists(out):
    shutil.rmtree(out)
os.makedirs(out)
for n in ['manifest.json', 'icons', 'options', 'popup', 'src']:
    p = os.path.join(repo, n)
    (shutil.copytree if os.path.isdir(p) else shutil.copy)(p, os.path.join(out, n))
NL = chr(92) + 'n'
sh = os.path.join(out, 'src', 'shared.js')
s = open(sh, encoding='utf-8').read()
assert '    debug: false' in s
s = s.replace('    debug: false', '    debug: true')
s = s.replace('https://ted160-30160.mikrus.cloud/v1/report', 'http://127.0.0.1:9/v1/report')
open(sh, 'w', encoding='utf-8', newline='\n').write(s)
cp = os.path.join(out, 'src', 'content.js')
s = open(cp, encoding='utf-8').read()
old = "const log = (...a) => { if (settings && settings.debug) console.debug('[CookieRejector]', location.hostname, ...a); };"
assert s.count(old) == 1
new = ("const log = (...a) => { if (settings && settings.debug) { try { sessionStorage.ccrLog = (sessionStorage.ccrLog || '') + "
       "Math.round(performance.now()) + ' ' + a.map(x => typeof x === 'string' || typeof x === 'number' ? x : "
       "(x && x.tagName) ? x.tagName + (x.id ? '#' + x.id : '') + (typeof x.className === 'string' && x.className ? '.' + x.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : JSON.stringify(x)).join(' ').slice(0, 4000) + '" + NL + "'; } catch (e) {} } };")
s = s.replace(old, new)
# plan przełączników: kategoria, stan przed i etykieta (do analizy błędnych kategorii)
old2 = "    res.changed = await setToggles(items);\n"
if s.count(old2) == 1:
    s = s.replace(old2, "    try { log('plan', plan.slice(0, 80).map(([t, c]) => `${c}${toggleState(t) ? '+' : '-'}:${toggleLabel(t).slice(0, 70)}`).join(' || ')); } catch (e) { /* ignore */ }\n" + old2)
# przyciski widziane w kroku 4 (gdy silnik się poddaje: ściana, zgłoszenie, ukrycie)
old3 = "    b = analyze(scope, cmp);\n    const text = norm(deepText(scope));\n"
if s.count(old3) == 1:
    s = s.replace(old3, old3 + "    try { log('step4', actionables(scope).filter(isVisible).slice(0, 25).map(e => `${classifyButton(labelOf(e)) || '-'}:${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/)[0] : ''}:${labelOf(e).slice(0, 40)}`).join(' | ')); } catch (e) { /* ignore */ }\n")
old4 = "        log('granular: brak panelu z przełącznikami');\n"
if s.count(old4) == 1:
    s = s.replace(old4, old4 + "        try { log('dialogs-now', deepQueryAll(document, '[role=\"dialog\"], [aria-modal=\"true\"], dialog[open]').filter(isShown).slice(0, 4).map(d => `${d.tagName}#${d.id}.${String(d.className).slice(0, 30)} t=${getToggles(d).length} ${norm(deepText(d)).slice(0, 80)}`).join(' || ')); } catch (e) { /* ignore */ }\n")
open(cp, 'w', encoding='utf-8', newline='\n').write(s)
print('ok', out)
