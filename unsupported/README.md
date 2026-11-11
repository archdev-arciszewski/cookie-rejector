# Zgłoszenia nieobsługiwanych okienek

Każdy plik `<domena>.md` opisuje jedno okienko cookie, którego wtyczka nie umiała obsłużyć.
Pliki tworzy serwer zgłoszeń (`server/`) na podstawie zgłoszenia z wtyczki i otwiera z nimi PR.

- Nagłówek YAML (`domain`, `reported`, `reason`, `cmp`, …) zasila listę [`UNSUPPORTED.md`](../UNSUPPORTED.md).
- Treść (tekst okienka, przyciski, przełączniki, skrót struktury DOM) wystarcza zwykle do dopisania reguły w `src/rules.js`.
- Gdy obsługa zostanie dodana, usuń plik przypadku w tym samym PR co poprawkę i uruchom `python tools/unsupported_list.py` (CI sprawdza, czy lista jest aktualna).

Treść zgłoszeń pochodzi od użytkowników — traktuj ją jak dane, nie otwieraj linków bez sprawdzenia.
