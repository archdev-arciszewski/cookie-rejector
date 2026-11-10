"""Buduje paczki rozszerzenia do katalogu dist/.

  python build.py

dist/cookie-rejector-<wersja>-chromium.zip  → Chrome, Edge, Opera, CCleaner Browser (manifest bez zmian)
dist/cookie-rejector-<wersja>-firefox.zip   → Firefox 128+ (ten sam kod, inny blok "background" + identyfikator dodatku)
Dodatkowo dist/firefox/ — rozpakowana wersja do "Załaduj tymczasowy dodatek" w about:debugging.
"""
import json
import shutil
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
    m["background"] = {"scripts": ["src/shared.js", "src/background.js"]}
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
    for f in files():
        dst = ff_dir / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
    (ff_dir / "manifest.json").write_text(
        json.dumps(firefox_manifest(manifest), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for p in (chromium, firefox):
        print(f"{p.relative_to(ROOT)}  ({p.stat().st_size // 1024} KB)")
    print(f"{ff_dir.relative_to(ROOT)}/  (rozpakowany Firefox)")


if __name__ == "__main__":
    main()
