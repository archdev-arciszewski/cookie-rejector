# Cookie Rejector

Wtyczka, która sama obsługuje banery zgód na cookies: zostawia **niezbędne** i **funkcjonalne**, a odrzuca resztę (analityczne, reklamowe, personalizację, media społecznościowe, partnerów / third-party, **uzasadniony interes** i wszystko niesklasyfikowane). Nie musisz nic klikać.

## Wspierane przeglądarki

Ten sam kod działa wszędzie tak samo — różni się tylko manifest paczki dla Firefoksa (blok `background` i identyfikator dodatku).

| Przeglądarka | Paczka | Status |
|---|---|---|
| Google Chrome | `chromium` | ✅ testowana |
| Microsoft Edge (157) | `chromium` | ✅ testy end-to-end |
| CCleaner Browser (154) | `chromium` | ✅ testy end-to-end + potwierdzona ręcznie |
| Mozilla Firefox (128+, testowany 159) | `firefox` | ✅ testy end-to-end |
| Opera | `chromium` | ⚠️ ta sama paczka co Chrome, nie testowana |

## Instalacja

Pobierz paczkę z zakładki **Releases** albo zbuduj ją sam: `python build.py` (wynik w `dist/`).

**Chrome, Edge, Opera, CCleaner Browser**
1. Otwórz stronę rozszerzeń: `chrome://extensions`, `edge://extensions`, `opera://extensions` (CCleaner może przekierować na własny adres).
2. Włącz **Tryb dewelopera**.
3. Kliknij **Załaduj rozpakowane** i wskaż folder repozytorium (albo rozpakowany `cookie-rejector-*-chromium.zip`).
4. Po instalacji otworzy się strona ustawień.

**Firefox**
- Na próbę: `about:debugging#/runtime/this-firefox` → **Załaduj tymczasowy dodatek** → wskaż `dist/firefox/manifest.json`. Dodatek znika po restarcie przeglądarki.
- Na stałe: zwykły Firefox instaluje tylko dodatki podpisane przez Mozillę. Paczkę `cookie-rejector-*-firefox.zip` trzeba podpisać na [addons.mozilla.org](https://addons.mozilla.org/developers/) (bezpłatnie, także jako „nielistowana”) albo użyć Firefox Developer Edition / Nightly z `xpinstall.signatures.required = false`.

## Jak działa

Dla każdego wykrytego banera (także w iframe'ach i Shadow DOM):

1. **Znane CMP przez API** — Cookiebot (`submitCustomConsent`) i Usercentrics (v2/v3): zgody ustawiane bezpośrednio, per kategoria.
2. **Ustawienia szczegółowe** — klika „Ustawienia / Dostosuj / Więcej opcji”, rozpoznaje każdy przełącznik po etykiecie i nagłówku wiersza (PL/EN/DE/FR/ES/IT/NL/CS), ustawia go zgodnie z Twoimi kategoriami, przechodzi do zakładek „Uzasadniony interes” i klika „Sprzeciw wobec wszystkich”, a na koniec „Zapisz”.
3. **Plan B** — „Odrzuć wszystkie” (na banerze albo w panelu ustawień). Jeśli wszystkie kategorie opcjonalne masz wyłączone, wtyczka od razu klika „Odrzuć”.
4. **Ściana „zgoda albo płać” / wymuszona akceptacja** — jeśli nie da się odrzucić, a na stronie jest subskrypcja/płatność (albo pełnoekranowa blokada z samym „Akceptuj”), wtyczka pokazuje **własne okienko z pytaniem**. „Tak” → klika akceptację na stronie. „Nie” → nic albo zamknięcie karty (do wyboru). Decyzję można zapamiętać dla domeny.
5. **Banery informacyjne** (pasek z samym „OK”, nieblokujący) — domyślnie ukrywane bez wyrażania zgody.

Reguły z selektorami dla: OneTrust, Cookiebot, Usercentrics, Didomi, Quantcast, Google Funding Choices, TrustArc, CookieYes, Complianz, Klaro, Osano, iubenda, consentmanager, Borlabs, Axeptio, CookieFirst, Cookie Script, Termly, Sourcepoint. Pozostałe są wykrywane heurystycznie (tekst + pozycja fixed/dialog + przyciski).

## Ustawienia (ikona → Ustawienia)

| Opcja | Domyślnie |
|---|---|
| Niezbędne | ✓ (zawsze) |
| Funkcjonalne / preferencje | ✓ |
| Analityczne, reklamowe, personalizacja, social media, partnerzy, uzasadniony interes, pozostałe | ✗ |
| Ustawiaj kategorie szczegółowo | ✓ |
| Gdy się nie uda | Odrzuć wszystkie |
| Ściany „zgoda albo płać” | Zapytaj mnie |
| Po odmowie | Nic nie rób (opcjonalnie: zamknij kartę) |
| Banery informacyjne | Ukryj |
| Powiadomienia (dymek w rogu) | ✓ |

W popupie ikony: wyłączenie wtyczki dla bieżącej strony, licznik obsłużonych banerów, ponowne skanowanie, zapomnienie zapamiętanej decyzji.

## Struktura

```
manifest.json
src/shared.js      kategorie, ustawienia domyślne
src/rules.js       słowniki heurystyk + reguły znanych CMP
src/content.js     silnik (wykrywanie, przełączniki, odrzucanie, ściany)
src/ui.js          okienko z pytaniem i dymek (zamknięty Shadow DOM)
src/page-api.js    wywołania JS-API CMP w kontekście strony
src/background.js  tło (service worker / Firefox: skrypt tła): konfiguracja, licznik, log, decyzje, zamykanie kart
options/, popup/   interfejs
build.py           buduje dist/*-chromium.zip i dist/*-firefox.zip
test/index.html    strona testowa: ?case=onetrust|tcf|reject|pay|wall|info|wp (silnik wstrzyknięty ze stubami)
test/e2e.mjs       testy end-to-end w prawdziwej przeglądarce z zainstalowanym rozszerzeniem (?ext=1)
test/serve.py      lokalny serwer testowy
```

## Testy

```bash
python build.py
python test/serve.py 8765        # uruchom w katalogu nadrzędnym repo
node test/e2e.mjs firefox "C:\Program Files\Mozilla Firefox\firefox.exe"
node test/e2e.mjs chromium "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

Skrypt uruchamia przeglądarkę w trybie headless na tymczasowym profilu, instaluje rozszerzenie i sprawdza wszystkie scenariusze (w tym odwzorowanie ściany „zgoda albo płać” z wp.pl).

## Ograniczenia

- To heurystyka — na nietypowych banerach może się pomylić. Włącz „Tryb debugowania” i patrz w konsolę (F12, prefiks `[CookieRejector]`), a stronę dodaj do wyłączonych, jeśli coś psuje.
- Wtyczka nie usuwa ciasteczek już zapisanych ani nie blokuje requestów — ustawia tylko wybór w banerze.

## Wkład w projekt

Pull requesty są mile widziane — zwłaszcza nowe reguły CMP w `src/rules.js` i słowa kluczowe w kolejnych językach. Zrób fork, gałąź i PR do `main`.

## Autor i licencja

Autor: **Paweł Arciszewski**. Licencja: [MIT](LICENSE).
