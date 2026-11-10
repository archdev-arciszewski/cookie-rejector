"""Buduje paczki rozszerzenia do katalogu dist/.

  python build.py

dist/cookie-rejector-<wersja>-chromium.zip  → Chrome, Edge, Opera, CCleaner Browser (manifest bez zmian)
dist/cookie-rejector-<wersja>-firefox.zip   → Firefox 128+ (ten sam kod, inny blok "background" + identyfikator dodatku)
Dodatkowo dist/firefox/ — rozpakowana wersja do "Załaduj tymczasowy dodatek" w about:debugging.

  python build.py --test-report-url http://127.0.0.1:18080/v1/report
dodatkowo buduje dist/test-chromium/ i dist/test-firefox/ z podmienionym adresem serwera zgłoszeń (tylko do testów e2e).
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
INCLUDE = ["manifest.json", "LICENSE", "icons", "src", "options", "popup"]

GECKO = {
    "id": "cookie-rejector@archdev-arciszewski",
    "strict_min_version": "128.0",  # content_scripts "world": "MAIN"
    "data_collection_permissions": {"required": ["none"]},
}


def files():
    for entry in INCLUDE:
        p = ROOT / entry
        if p.is_file():
            yield p
        else:
            yield from sorted(x for x in p.rglob("*") if x.is_file())


def firefox_manifest(m):
    m = json.loads(json.dumps(m))
    m["background"] = {"scripts": ["src/shared.js", "src/pow.js", "src/background.js"]}
    m["browser_specific_settings"] = {"gecko": GECKO}
    return m


def write_zip(path, manifest):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files():
            rel = f.relative_to(ROOT).as_posix()  # Firefox wymaga "/" w ścieżkach
            if rel == "manifest.json":
                z.writestr(rel, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            else:
                z.write(f, rel)


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    chromium = DIST / f"cookie-rejector-{version}-chromium.zip"
    firefox = DIST / f"cookie-rejector-{version}-firefox.zip"
    write_zip(chromium, manifest)
    write_zip(firefox, firefox_manifest(manifest))

    ff_dir = DIST / "firefox"
    write_dir(ff_dir, firefox_manifest(manifest))
    for p in (chromium, firefox):
        print(f"{p.relative_to(ROOT)}  ({p.stat().st_size // 1024} KB)")
    print(f"{ff_dir.relative_to(ROOT)}/  (rozpakowany Firefox)")

    if "--test-report-url" in sys.argv:
        url = sys.argv[sys.argv.index("--test-report-url") + 1]
        write_dir(DIST / "test-chromium", manifest, url)
        write_dir(DIST / "test-firefox", firefox_manifest(manifest), url)
        print(f"dist/test-chromium/, dist/test-firefox/  (serwer zgłoszeń: {url})")


def write_dir(out, manifest, report_url=None):
    for f in files():
        dst = out / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if report_url:
        shared = out / "src" / "shared.js"
        text = shared.read_text(encoding="utf-8")
        marker = "const REPORT_URL = '"
        start = text.index(marker) + len(marker)
        end = text.index("'", start)
        shared.write_text(text[:start] + report_url + text[end:], encoding="utf-8")


if __name__ == "__main__":
    main()
