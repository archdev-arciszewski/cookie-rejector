# Serwer zgłoszeń

Przyjmuje zgłoszenia nieobsługiwanych okienek cookie z wtyczki i zamienia je w PR-y w tym repozytorium
(plik `unsupported/<domena>.md` na gałęzi `report/<domena>`). Działa jako GitHub App, więc w wtyczce nie ma żadnego tokenu.

Jeden plik, bez zależności, Node 22+: [`index.mjs`](index.mjs). Testy z atrapą API GitHuba: `node server/test.mjs`.

## Protokół

`POST /v1/report`, `Content-Type: text/plain` (prosty request CORS, bez preflight):

```
ccr1 <ts w ms, 13 cyfr> <nonce> <bity>
{ ...zgłoszenie JSON... }
```

Proof-of-work: `sha256("<sha256hex(JSON)>:<ts>:<nonce>")` musi zaczynać się od `bity` zerowych bitów
(`src/pow.js`). Gdy serwer wymaga więcej bitów, odpowiada `428 {"status":"pow","powBits":N}`, a wtyczka liczy ponownie.

Odpowiedzi (`status`): `created` (nowy PR), `known` (domena już zgłoszona, `url` do PR/pliku), `stored`
(aplikacja GitHub jeszcze nieskonfigurowana — zgłoszenie czeka w `pending/`), `limited`, `busy`, `rate-limited`,
`duplicate`, `pow`, `pow-invalid`, `clock`, `invalid`, `invalid-host`.

Zamknięte zgłoszenia: przy zgłoszeniu znanej domeny serwer co `RECHECK_HOURS` sprawdza, czy zgłoszenie jest
nadal otwarte (plik `unsupported/<domena>.md` w `main` albo otwarty PR `report/<domena>`). Jeśli nie, zapamiętuje
wersję z `manifest.json` w `main` jako wersję z poprawką. Wtyczki starsze od niej dostają `known` (poprawka czeka
na aktualizację), a zgłoszenie z wersji z poprawką lub nowszej otwiera nowy PR (regresja). Stara gałąź
`report/<domena>` jest wtedy usuwana i zakładana od nowa.

Inne endpointy: `GET /health`, `GET /setup?token=…` i `GET /setup/callback` (jednorazowe tworzenie GitHub App).

## Ochrona przed spamem i DDoS

- Przed serwerem stoi Cloudflare (domena `*.mikrus.cloud`) — on bierze na siebie ataki wolumetryczne.
- Serwer zrywa połączenia spoza zaufanego proxy (`TRUSTED_PROXIES`), więc nie da się go ominąć bezpośrednim adresem.
- Proof-of-work (domyślnie 20 bitów, ~1 s w przeglądarce) — masowe wysyłanie jest kosztowne, sprawdzenie to jeden hasz.
- Limity: 4 zgłoszenia / 10 min i 12 / dobę na IP (IPv6 liczone jako /64), maks. 3 równoległe zapytania na IP,
  jeden PR na domenę, 25 PR-ów dziennie, maks. 40 otwartych PR-ów ze zgłoszeniami, kolejka 20.
- Treść ≤ 48 KB, nagłówki 5 s, całe zapytanie 10 s, blokada powtórzeń tej samej treści, domena musi istnieć w DNS.

## Treść zgłoszeń (phishing, prompt injection)

Zgłaszający może podać dowolną istniejącą domenę i dowolny tekst, np. stronę phishingową z treścią udającą polecenia
dla asystenta AI, który potem obsługuje zgłoszenie. Dlatego:

- Wszystkie pola są walidowane i przycinane. Ścieżka adresu zawiera tylko znaki dozwolone w URL (bez spacji i nowych
  linii), a nagłówek YAML pliku zawsze ma wartości w jednej linii, więc nie da się dopisać pól ani wyjść poza nagłówek.
- Tekst ze strony trafia do bloków kodu (płot dłuższy niż każdy ciąg backticków w treści). Komórki tabel są kodem
  inline, więc GitHub nie tworzy w nich linków, wzmianek `@`, odwołań `#` ani HTML.
- Dane ze zgłoszenia leżą między znacznikami z losowym identyfikatorem, którego zgłaszający nie zna. Plik i PR
  zaczynają się ostrzeżeniem, że to dane, a nie polecenia, z odnośnikiem do zasad w [AGENTS.md](../AGENTS.md).
- Treść wyglądająca na polecenia dla AI albo komendy powłoki oznacza zgłoszenie (`suspicious: tak`, ⚠️ w tytule PR,
  ostrzeżenie w treści). Zgłoszenie nie jest odrzucane: taki filtr łatwo obejść, a o obsłudze decyduje człowiek.
- `tools/unsupported_list.py` przenosi do `UNSUPPORTED.md` tylko pola o ściśle określonym formacie.
- PR-y ze zgłoszeniami nie zmieniają kodu. Akcja GitHuba na gałęziach `report/*` tylko generuje listę z nagłówków
  plików, a treści zgłoszenia nigdy nie wykonuje.

Adresy IP są trzymane tylko w pamięci (na potrzeby limitów) i nie trafiają do logów ani na dysk.

## Konfiguracja (zmienne środowiskowe)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT`, `HOST` | `8080`, `::` | nasłuch (`::` = IPv4 i IPv6) |
| `PUBLIC_URL` | `http://localhost:8080` | publiczny adres (do przekierowania z GitHuba) |
| `DATA_DIR` | `./data` | stan, oczekujące zgłoszenia, klucz GitHub App |
| `GH_OWNER`, `GH_REPO`, `GH_BASE` | `archdev-arciszewski`, `cookie-rejector`, `main` | repozytorium docelowe |
| `GH_APP_NAME` | `cookie-rejector-reports` | nazwa tworzonej GitHub App |
| `SETUP_TOKEN` | — | sekret do `/setup`; bez niego konfiguracja jest wyłączona |
| `TRUSTED_PROXIES` | — | prefiksy adresów proxy, po przecinku; puste = tryb deweloperski |
| `POW_BITS` | `20` | trudność proof-of-work |
| `IP_PER_10M`, `IP_PER_DAY`, `PR_PER_DAY`, `MAX_OPEN_PRS`, `MAX_QUEUE` | `4`, `12`, `25`, `40`, `20` | limity |
| `RECHECK_HOURS` | `6` | jak często sprawdzać, czy zgłoszenie znanej domeny zostało zamknięte |
| `CHECK_DNS` | `1` | `0` wyłącza sprawdzanie domeny w DNS (testy) |

## Wdrożenie (mikrus ted160)

```bash
mkdir -p /opt/cookie-rejector-reports/app /root/MCPAPPS/cookie-rejector-reports/data
chown 1000:1000 /root/MCPAPPS/cookie-rejector-reports/data && chmod 700 /root/MCPAPPS/cookie-rejector-reports/data
# skopiuj server/index.mjs do /opt/cookie-rejector-reports/app/
# /opt/cookie-rejector-reports/env (0600): PORT=30160, PUBLIC_URL=https://ted160-30160.mikrus.cloud,
#   DATA_DIR=/data, TRUSTED_PROXIES=<prefiks proxy mikrusa>, SETUP_TOKEN=<losowy>
docker run -d --name cookie-rejector-reports --restart=always --network host \
  --read-only --tmpfs /tmp:size=8m --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 0.5 --pids-limit 64 --log-opt max-size=5m --log-opt max-file=3 \
  --env-file /opt/cookie-rejector-reports/env \
  -v /opt/cookie-rejector-reports/app:/app:ro -v /root/MCPAPPS/cookie-rejector-reports/data:/data \
  -w /app node:22-alpine node index.mjs
```

Aktualizacja: podmień `index.mjs` i `docker restart cookie-rejector-reports`.

### Jednorazowa konfiguracja GitHub App

1. Otwórz `https://<PUBLIC_URL>/setup?token=<SETUP_TOKEN>` i kliknij „Utwórz GitHub App” → na GitHubie „Create”.
   Klucz prywatny trafia od razu na serwer (`DATA_DIR/app.pem`, 0600).
2. Zainstaluj aplikację **tylko** w repozytorium `cookie-rejector`.
3. `GET /health` pokazuje `"configured": true`; zgłoszenia z `pending/` zostaną wysłane w ciągu 5 minut.

Uprawnienia aplikacji: `contents: write`, `pull_requests: write`, `metadata: read`. Gałąź `main` chroni ruleset
repozytorium, więc aplikacja może tylko otwierać PR-y, a merge zostaje po stronie właściciela.
