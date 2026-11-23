#!/usr/bin/env python3
"""Build download/wave-apk-ready.zip from the current project tree (no git).
Excludes build outputs, deps, scratch, and private dirs. Prefix: wave/"""
import zipfile, pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
OUT = ROOT / "download/wave-apk-ready.zip"

EXCLUDE_DIRS = {
    "node_modules", ".next", "out", "download", "upload", "skills", "apkwork",
    ".git", ".gradle", "build", "capacitor-cordova-android-plugins", ".idea", ".vscode",
}
EXCLUDE_FILES = {
    "dev.log", "wave-apk-ready.zip", "local.properties", "java_import_audit.py",
    "rebuild_apk_zip.py", "build_zip.py", ".DS_Store", "check_env.py",
}
# scratch QA/debug artifacts (session screenshots, probe scripts) — not project files
SCRATCH_PREFIXES = ("debug-", "probe-", "test-", "q-", "search-audit", "lang-stationary-sim", "trace-resolve")
SCRATCH_SUFFIXES = (".png", ".zip", ".log")


def is_scratch(rel: pathlib.PurePath) -> bool:
    name = rel.name
    if rel.suffix in SCRATCH_SUFFIXES and (len(rel.parts) == 1 or str(rel.parent) == "scripts"):
        return True
    if str(rel.parent) == "scripts" and name.startswith(SCRATCH_PREFIXES):
        return True
    return name in EXCLUDE_FILES


files = []
for p in sorted(ROOT.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT)
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        continue
    if is_scratch(rel):
        continue
    files.append(rel)

print(f"packing {len(files)} files")
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(ROOT / rel, "wave/" + str(rel))

# verify the four changed files carry the new code
with zipfile.ZipFile(OUT) as z:
    svc = z.read("wave/android/app/src/main/java/com/deeraj/wave/MediaPlaybackService.java").decode()
    plg = z.read("wave/android/app/src/main/java/com/deeraj/wave/WaveAudioPlugin.java").decode()
    nb = z.read("wave/src/lib/nativeBackground.ts").decode()
    pl = z.read("wave/src/lib/player.tsx").decode()
    checks = [
        ("SystemClock import (prev fix kept)", "import android.os.SystemClock;" in svc),
        ("NO audio-focus request (Chromium owns focus — play must not pause)", "requestAudioFocus" not in svc and "AudioFocusRequest" not in svc and "focusListener" not in svc),
        ("noisy receiver (BT/wired pause)", "ACTION_AUDIO_BECOMING_NOISY" in svc and "RECEIVER_NOT_EXPORTED" in svc),
        ("playingNow truth flag", "static volatile boolean playingNow" in svc),
        ("plugin getNativeState", "getNativeState" in plg and "playingNow" in plg),
        ("web helper getNativePlaybackState", "getNativePlaybackState" in nb),
        ("player asks native before autoplay", "mayAutoPlay" in pl and "getNativePlaybackState" in pl),
        ("paused-restore fallback", "paused: true, restored: true" in pl),
    ]
    bad = 0
    for name, ok in checks:
        print(("PASS  " if ok else "FAIL  ") + name)
        bad += 0 if ok else 1
    if bad:
        sys.exit("zip verification failed")

# stage the changed files at download/ root for the one-file GitHub upload path
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

print("done:", OUT, f"{OUT.stat().st_size:,} bytes")
