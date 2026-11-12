"""Generuje UNSUPPORTED.md z plików unsupported/<domena>.md (nagłówek YAML na początku pliku).

  python tools/unsupported_list.py          # zapisuje UNSUPPORTED.md
  python tools/unsupported_list.py --check  # kod wyjścia 1, jeśli plik jest nieaktualny

Uruchamiany automatycznie przez .github/workflows/unsupported-list.yml — nie edytuj UNSUPPORTED.md ręcznie.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "unsupported"
OUT = ROOT / "UNSUPPORTED.md"

REASONS = {
    "reject-failed": "odrzucenie / ustawienia nie zadziałały",
    "no-accept": "brak obsługiwanego przycisku",
    "unrecognized": "nierozpoznane przyciski",
    "manual": "zgłoszenie ręczne",
}


def front_matter(text):
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            k, sep, v = line.partition(":")
            if sep:
                meta[k.strip()] = v.strip()
    return meta


# Pliki zgłoszeń pochodzą od anonimowych użytkowników — do listy trafiają tylko pola o ściśle określonym formacie.
DOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CMP_RE = re.compile(r"^[\w .-]{1,40}$")


def safe(meta, key, rx, default="—"):
    v = meta.get(key, "")
    return v if rx.match(v) else default


def cell(s):
    s = re.sub(r"[\r\n|<>`\\*_\[\]]", " ", str(s or "")).strip()
    return s or "—"


def build():
    rows = []
    for f in sorted(DIR.glob("*.md")):
        if f.name.lower() == "readme.md":
            continue
        if not DOMAIN_RE.match(f.stem):
            continue
        meta = front_matter(f.read_text(encoding="utf-8"))
        rows.append((f.stem, meta, f.name))
    rows.sort(key=lambda r: r[0])

    lines = [
        "# Nieobsługiwane okienka cookie",
        "",
        "Lista stron, na których wtyczka wykryła okienko zgód, ale nie umiała go obsłużyć.",
        "Zgłoszenia przychodzą z wtyczki (przycisk „Zgłoś”) jako PR-y; szczegóły każdego przypadku są w katalogu [`unsupported/`](unsupported/).",
        "Gdy obsługa zostanie dodana, plik przypadku usuwa się w PR z poprawką i odświeża listę (`python tools/unsupported_list.py`; CI tego pilnuje).",
        "",
        "> Plik generowany automatycznie (`python tools/unsupported_list.py`). Nie edytuj go ręcznie.",
        "",
    ]
    if not rows:
        lines.append("_Brak zgłoszeń._")
    else:
        lines += [
            f"Przypadków: **{len(rows)}**",
            "",
            "| Domena | Zgłoszono | CMP | Problem | Szczegóły |",
            "|---|---|---|---|---|",
        ]
        for domain, meta, name in rows:
            reason = REASONS.get(meta.get("reason", ""), "—")
            cmp = safe(meta, "cmp", CMP_RE)
            lines.append(
                f"| {cell(domain)} | {cell(safe(meta, 'reported', DATE_RE))} | {cell('—' if cmp == '-' else cmp)} "
                f"| {cell(reason)} | [{name}](unsupported/{name}) |"
            )
    return "\n".join(lines) + "\n"


def main():
    content = build()
    current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if "--check" in sys.argv:
        sys.exit(0 if current == content else 1)
    if current != content:
        OUT.write_text(content, encoding="utf-8", newline="\n")
        print("UNSUPPORTED.md zaktualizowany")
    else:
        print("UNSUPPORTED.md aktualny")


if __name__ == "__main__":
    main()
