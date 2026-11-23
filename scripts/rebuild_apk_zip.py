#!/usr/bin/env python3
"""Rebuild download/wave-apk-ready.zip using the previous zip's exact file list,
with all contents re-read from disk (picking up the SystemClock import fix)."""
import zipfile, pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
OLD = ROOT / "download/wave-apk-ready.zip"
NEW = ROOT / "download/wave-apk-ready.zip"  # overwrite in place via temp then move
TMP = ROOT / "download/wave-apk-ready.new.zip"

with zipfile.ZipFile(OLD) as old:
    names = [n for n in old.namelist() if not n.endswith("/")]

missing = []
for n in names:
    rel = n[len("wave/"):] if n.startswith("wave/") else n
    if not (ROOT / rel).exists():
        missing.append(n)
if missing:
    print("MISSING FROM DISK (kept from old zip):", *missing, sep="\n  ")

with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as out:
    for n in names:
        rel = n[len("wave/"):] if n.startswith("wave/") else n
        p = ROOT / rel
        if p.exists():
            out.write(p, n)
        else:
            with zipfile.ZipFile(OLD) as old:
                out.writestr(n, old.read(n))

# verify the fixed file made it in
with zipfile.ZipFile(TMP) as z:
    data = z.read("wave/android/app/src/main/java/com/deeraj/wave/MediaPlaybackService.java").decode()
    ok_import = "import android.os.SystemClock;" in data
    ok_use = data.count("SystemClock.elapsedRealtime()") == 2
    print("zip entry check: import present:", ok_import, "| both usages present:", ok_use)
    if not (ok_import and ok_use):
        sys.exit("FIX NOT IN ZIP — aborting")

TMP.replace(NEW)
print("rebuilt:", NEW, NEW.stat().st_size, "bytes")

# also drop every changed file at download/ root for the one-file GitHub upload path
import shutil
CHANGED = [
    "android/app/src/main/java/com/deeraj/wave/MediaPlaybackService.java",
    "android/app/src/main/java/com/deeraj/wave/WaveAudioPlugin.java",
    "src/lib/nativeBackground.ts",
    "src/lib/player.tsx",
]
for rel in CHANGED:
    src = ROOT / rel
    shutil.copy2(src, ROOT / "download" / src.name)
    print("staged:", src.name)
