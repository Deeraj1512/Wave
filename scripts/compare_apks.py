#!/usr/bin/env python3
"""Compare v34 vs v36 across ALL JS chunks + version strings + find the `so` native flag."""
import zipfile, re

V34 = "/home/z/my-project/upload/wave-v34.apk"
V36 = "/home/z/my-project/upload/wave-v36.apk"

MARKERS = [
    "Go to album",
    "wave:open-album",
    "Opening album",
    "Album not found for this song",
    "album-overlay",
    "Sleep timer",
    "Start radio",
]

def scan(apk):
    with zipfile.ZipFile(apk) as z:
        names = [n for n in z.namelist() if n.endswith(".js") and n.startswith("assets/public/_next")]
        found = {m: [] for m in MARKERS}
        for n in names:
            code = z.read(n).decode("utf-8", "ignore")
            for m in MARKERS:
                if m in code:
                    found[m].append(n.split("/")[-1])
        man = z.read("AndroidManifest.xml")
        txt = man.decode("utf-16-le", "ignore")
        pool = re.findall(r"[\x20-\x7e]{3,}", txt)
        ver = [s for s in pool if re.match(r"^\d+(\.\d+)+$", s)]
        return found, ver[:10], names

for apk in (V34, V36):
    found, ver, names = scan(apk)
    print(f"=== {apk.split('/')[-1]}  ({len(names)} Next chunks) ===")
    for m in MARKERS:
        print(f"  {'PRESENT' if found[m] else '  ABSENT'}  {m}  {found[m][:2]}")
    print(f"  versionName candidates from manifest: {ver}\n")
