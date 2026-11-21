# Crawl na prawdziwych stronach

Przechodzi listę prawdziwych stron w Chromium (Playwright, headless, tymczasowy profil) — z zainstalowaną wtyczką
i bez niej — i sprawdza, co wtyczka zrobiła. Na stronach nic poza wtyczką nie jest klikane ani wpisywane
(zasady jak w [AGENTS.md](../../AGENTS.md)).

## Uruchomienie

Playwright nie jest zależnością repozytorium. Wskaż dowolny katalog z `node_modules/playwright`
(np. `npm i -D playwright` w osobnym folderze, przeglądarki: `npx playwright install chromium`):

```bash
python tools/crawl/mkext.py . /tmp/ccr-ext                      # kopia wtyczki: debug + log w sessionStorage
CCR_PLAYWRIGHT=/sciezka/do/projektu node tools/crawl/crawl.mjs --sites tools/crawl/sites.json --out /tmp/run-base --baseline --conc 3 --wait 10000
CCR_PLAYWRIGHT=/sciezka/do/projektu node tools/crawl/crawl.mjs --sites tools/crawl/sites.json --out /tmp/run-ext --ext /tmp/ccr-ext --conc 4 --wait 16000
node tools/crawl/analyze.mjs /tmp/run-ext /tmp/run-base --md /tmp/crawl.md
```

`--only <regex>` zawęża listę (np. do stron, które się nie udały). Przerwany crawl można wznowić tym samym poleceniem —
strony już zapisane w `results.jsonl` są pomijane. Każda strona ma twardy limit 90 s, a co 30 stron startuje świeży profil.

## Co jest mierzone

- log silnika wtyczki ze wszystkich ramek (wykryte okienko, kliknięcia, plan przełączników, przyciski widziane, gdy silnik się poddaje),
- niezależny detektor okienek zgody na ekranie (także w otwartym Shadow DOM i ramkach znanych CMP) — przed i po,
- stan **IAB TCF** (`__tcfapi('getTCData')`): zgody na cele, uzasadniony interes, funkcje specjalne,
- nazwy ciasteczek zgód, zrzut ekranu.

## Klasy wyniku (`analyze.mjs`)

| Klasa | Znaczenie |
|---|---|
| `OK_HANDLED` | wtyczka obsłużyła okienko, nic nie zostało na ekranie |
| `OK_NOBANNER` | nie było okienka ani bez wtyczki, ani z nią |
| `BAD_ACCEPT` | kliknięta akceptacja albo w TCF zostały zgody / funkcje specjalne (poza celem 1) — **najgorszy wynik** |
| `SITE_DEFAULT` | zgody w TCF są takie same bez wtyczki (domyślne ustawienie strony, nie nasze kliknięcie) |
| `WALL_PROMPT` | wtyczka pyta użytkownika (ściana „zgoda albo płać” / tylko „Akceptuj”) |
| `OFFERED` | propozycja zgłoszenia — obsługa się nie udała |
| `MISSED` | okienko jest na ekranie, wtyczka go nie wykryła |
| `HANDLED_RESIDUAL` | obsłużone, ale detektor nadal coś widzi (często coś innego: bramka wieku, czat) |
| `CONCEALED_LEFT` | na stronie zostało ukrycie wtyczki (`clip-path … !important`) |
| `CLICKED_NO_RESULT` / `MISSED_GONE` | do ręcznego przejrzenia (często strona przeładowała się po kliknięciu) |
| `BLOCKED` / `ERROR` | strona blokuje przeglądarkę headless (403) albo nie wczytała się — **tych blokad nie obchodzimy** |

Wyniki zależą od kraju (crawl z Polski) i od tego, że część stron nie pokazuje okienek przeglądarce headless.
