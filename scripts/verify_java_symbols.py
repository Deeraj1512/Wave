#!/usr/bin/env python3
"""Compile the 3 Wave Java files against the real Android 15 framework jar (ECJ),
then classify every diagnostic. Anything unresolved must belong to libraries that
exist in the real project (androidx, support, capacitor) — zero android.*/java.*
errors allowed. This is the check that catches member-level API mistakes."""
import subprocess, re, sys

SRC = "/home/z/my-project/android/app/src/main/java"
cmd = ["java", "-jar", "/tmp/ecj.jar", "-1.8", "-nowarn", "-cp", "/tmp/android-all.jar",
       "-d", "/tmp/ecj-out",
       f"{SRC}/com/deeraj/wave/MediaPlaybackService.java",
       f"{SRC}/com/deeraj/wave/MainActivity.java",
       f"{SRC}/com/deeraj/wave/WaveAudioPlugin.java"]
r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
out = r.stdout + r.stderr

# --- exempt libraries: shipped via real gradle deps, absent from the bare framework jar
EXEMPT = ("androidx.", "android.support.v4.", "com.getcapacitor.", "android.support.annotation.")

# ECJ diagnostic blocks look like:
# ----------
# N. ERROR in /path (at line 309)
#     <code snippet>
#     ^^^^^
# <message>
blocks = re.split(r"\n-+\n", out)
errors = []
for b in blocks:
    m = re.search(r"(\d+)\. (ERROR|WARNING) in (.+?) \(at line (\d+)\)", b)
    if not m or m.group(2) != "ERROR":
        continue
    msg = b.strip().splitlines()[-1].strip()
    errors.append((int(m.group(4)), msg))

real, exempt = [], []
# exempt SIMPLE class names, harvested from each file's own import lines
# (androidx / support / capacitor classes exist in the real project deps)
imports = {}
for path in ("MediaPlaybackService.java", "MainActivity.java", "WaveAudioPlugin.java"):
    txt = open(f"{SRC}/com/deeraj/wave/{path}").read()
    imports[path] = {m.group(2) for m in re.finditer(
        r"^import\s+(?:static\s+)?((?:androidx|android\.support|com\.getcapacitor)\.[\w.]*?(\w+))\s*;",
        txt, re.M)}
ALL_EXEMPT_NAMES = {n for names in imports.values() for n in names}
EXEMPT_RE = re.compile(r"androidx|android\.support|com\.getcapacitor")
CONSEQUENCE_RE = re.compile(
    r"must override or implement a supertype method|\bbridge\b cannot be resolved")
# inherited from com.getcapacitor.Plugin (verified in node_modules Plugin.java:200,208)
CAPACITOR_INHERITED = re.compile(
    r"The method (getContext|getActivity)\(\) is undefined for the type WaveAudioPlugin")
for line, msg in errors:
    first = msg.split(" ")[0].rstrip("<>()")
    # "The method X(...) is undefined for the type MainActivity" — only a
    # consequence when the RECEIVER's supertype is missing (MainActivity);
    # AudioManager/Context receivers would mean a REAL api-name bug
    undef_recv = re.search(r"is undefined for the type (\w+)", msg)
    undef_exempt = bool(undef_recv and undef_recv.group(1) in ("MainActivity", "MediaPlaybackService"))
    if (EXEMPT_RE.search(msg) or CONSEQUENCE_RE.search(msg)
            or CAPACITOR_INHERITED.search(msg)
            or first in ALL_EXEMPT_NAMES or undef_exempt):
        exempt.append((line, msg))
    else:
        real.append((line, msg))

print(f"total errors: {len(errors)} | exempt (real deps, not in bare jar): {len(exempt)} | REAL: {len(real)}")
if exempt:
    print("--- exempt errors (expected) ---")
    for line, msg in exempt[:40]:
        print(f"  L{line}: {msg[:110]}")
if real:
    print("--- REAL PROBLEMS ---")
    for line, msg in real:
        print(f"  L{line}: {msg}")
    sys.exit(1)
print("RESULT: every android.*/java.* symbol resolves against the real framework — SAFE TO BUILD")
