#!/usr/bin/env python3
"""Inspect a Capacitor APK: list WebView assets, search JS bundles for feature markers."""
import zipfile, sys, re, os

APK = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/wave-v36.apk"

MARKERS = [
    "Go to album",
    "OPEN_ALBUM_EVENT",
    "Album not found for this song",
    "Opening album",
    "album-overlay",
    "waveBack",
    "familiarBoost",
    "artistCatalog",
    "capacitor",
]

with zipfile.ZipFile(APK) as z:
    names = z.namelist()
    print(f"=== {os.path.basename(APK)} : {len(names)} entries ===\n")

    # 1. Show top-level structure
    tops = {}
    for n in names:
        top = n.split("/")[0]
        tops[top] = tops.get(top, 0) + 1
    print("Top-level dirs/counts:")
    for k in sorted(tops):
        print(f"  {k}: {tops[k]}")

    # 2. WebView asset dir (capacitor puts web assets in assets/public)
    pub = [n for n in names if n.startswith("assets/public/")]
    print(f"\nassets/public/ entries: {len(pub)}")
    for n in sorted(pub)[:40]:
        info = z.getinfo(n)
        print(f"  {n}  ({info.file_size} bytes)")

    # 3. index.html content
    idx = "assets/public/index.html"
    if idx in names:
        html = z.read(idx).decode("utf-8", "ignore")
        print(f"\n--- index.html (first 1200 chars) ---")
        print(html[:1200])

    # 4. Search JS bundles for markers
    js_files = [n for n in pub if n.endswith(".js")]
    print(f"\nJS bundles: {len(js_files)}")
    found = {}
    for jf in js_files:
        data = z.read(jf).decode("utf-8", "ignore")
        for m in MARKERS:
            if m in data:
                found.setdefault(m, []).append(jf)
    print("\nMarker scan results:")
    for m in MARKERS:
        hits = found.get(m)
        print(f"  {'FOUND ' if hits else 'MISSING'} {m}" + (f"  -> {hits}" if hits else ""))

    # 5. versionName from the APK filename-level info via resources is hard; check manifest presence
    print("\nHas android/app/src assets?")
    for n in sorted(names):
        if "assets/public" not in n and n.startswith("assets/"):
            print("  ", n)
