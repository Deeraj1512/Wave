#!/usr/bin/env python3
"""Deep-dive: extract the chunk with new UI code and analyze the album logic + search endpoints."""
import zipfile, re, os

APK = "/home/z/my-project/upload/wave-v36.apk"
CHUNK = "assets/public/_next/static/chunks/11965e51f7d51335.js"

with zipfile.ZipFile(APK) as z:
    code = z.read(CHUNK).decode("utf-8", "ignore")
    cfg = z.read("assets/capacitor.config.json").decode("utf-8", "ignore")
    plugins = z.read("assets/capacitor.plugins.json").decode("utf-8", "ignore")

print("=== capacitor.config.json ===")
print(cfg)
print("\n=== capacitor.plugins.json ===")
print(plugins)

def show(label, pattern, width=260, count=3):
    print(f"\n=== {label} ===")
    hits = [m.start() for m in re.finditer(pattern, code)]
    print(f"{len(hits)} occurrence(s)")
    for h in hits[:count]:
        s = max(0, h - width // 2)
        frag = code[s:h + width]
        frag = frag.replace("\n", " ")
        print("  ..." + frag + "...\n")

# 1. Context around each "Go to album"
show('"Go to album"', r'Go to album', 300, 6)

# 2. Event name used for opening album (search variants)
show('open-album event', r'open[-_]?album', 200, 8)

# 3. canGoToAlbum guard
show('canGoToAlbum', r'canGoToAlbum|canGoAlbum|albumResolv', 200, 4)

# 4. Search API endpoints used by the app
show('api/search', r'/api/search', 200, 4)
show('absolute api hosts', r'https://[a-zA-Z0-9._\-]+/(api|search)[a-zA-Z0-9._/\-]*', 160, 10)

# 5. resolveAlbum / goToAlbum internals
show('resolve album fn', r'resolveAlbum|albumId|youtubeId|browseId', 180, 8)

# 6. Check whether fetch calls go to relative or absolute paths
show('fetch patterns', r'fetch\((?:"|`|\w)', 200, 10)
