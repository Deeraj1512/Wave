#!/usr/bin/env python3
"""Heuristic audit: find identifiers used as classes but not imported (like the SystemClock bug)."""
import re, sys, pathlib

FILES = [
    "/home/z/my-project/android/app/src/main/java/com/deeraj/wave/MainActivity.java",
    "/home/z/my-project/android/app/src/main/java/com/deeraj/wave/MediaPlaybackService.java",
    "/home/z/my-project/android/app/src/main/java/com/deeraj/wave/WaveAudioPlugin.java",
]

JAVA_LANG = {"String","Object","Integer","Long","Double","Float","Boolean","Byte","Short","Math",
             "System","Thread","Runnable","Exception","RuntimeException","IllegalArgumentException",
             "IllegalStateException","NullPointerException","Void","CharSequence","Iterable","Number",
             "Enum","Class","Override","Deprecated","SuppressWarnings","SafeVarargs","Error","Cloneable"}

problems = 0
for f in FILES:
    src = pathlib.Path(f).read_text()
    # strip comments and string literals so we don't flag text inside them
    src_clean = re.sub(r'//.*', '', src)
    src_clean = re.sub(r'/\*.*?\*/', '', src_clean, flags=re.S)
    src_clean = re.sub(r'"(?:[^"\\]|\\.)*"', '""', src_clean)
    src_clean = re.sub(r"'(?:[^'\\]|\\.)*'", "''", src_clean)

    imports = set()
    for m in re.finditer(r'^import\s+(?:static\s+)?([\w.]+)\s*;', src_clean, re.M):
        parts = m.group(1).split('.')
        imports.add(parts[-1])  # simple name (works for single-type imports)
    # local classes of the package
    pkg_dir = pathlib.Path(f).parent
    locals_ = {p.stem for p in pkg_dir.glob("*.java")}

    # identifiers used in class-position: "X.something", "new X(", "extends X", "(X) cast",
    # declarations "X name", generics "<X>", catch "(X e)", annotations "@X"
    used = set(re.findall(r'\bnew\s+([A-Z]\w*)', src_clean))
    used |= set(re.findall(r'(?:extends|implements)\s+([A-Z]\w*)', src_clean))
    used |= set(re.findall(r'\(\s*([A-Z]\w*)\s+\w+\s*\)\s*(?:\{|;|throw|return|if)', src_clean))  # catch/params-ish
    used |= set(re.findall(r'@([A-Z]\w*)', src_clean))
    used |= set(re.findall(r'<([A-Z]\w*)(?:,|>|\s)', src_clean))
    used |= set(re.findall(r'\b([A-Z]\w*)\.\w', src_clean))
    used |= set(re.findall(r'(?:long|int|float|double|boolean|void|String|Bitmap|Intent|Notification)\s+([A-Z]\w*)\s*\(', src_clean))

    missing = sorted(u for u in used
                     if u not in imports and u not in JAVA_LANG and u not in locals_
                     and not u.startswith(('R','Build','Manifest')) and u != 'R')
    # Build/Manifest/R are android pkg root classes that MUST be imported (Build is imported here);
    # re-check them properly:
    for root_cls in ("Build", "Manifest"):
        if root_cls in used and root_cls not in imports:
            problems += 1
            print(f"[FAIL] {pathlib.Path(f).name}: uses '{root_cls}' but never imports it")
    real_missing = [u for u in missing if u not in ("Build", "Manifest")]
    if real_missing:
        for u in real_missing:
            problems += 1
            print(f"[WARN?] {pathlib.Path(f).name}: '{u}' used but not imported — verify manually")
    if not real_missing:
        print(f"[OK]   {pathlib.Path(f).name}: every referenced class is imported")

sys.exit(1 if problems else 0)
