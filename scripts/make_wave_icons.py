#!/usr/bin/env python3
"""
Wave app-icon factory.

Input : upload/pasted_image_1793078438209.png (black music-staff artwork on
        transparency, "Designed by Pngtree" watermark strip at the bottom).
Output: src/app/favicon.ico      (16/32/48)
        src/app/icon.png         (512, Next.js app-router icon)
        src/app/apple-icon.png   (180, iOS home-screen)
        public/wave-mark.png     (256, header brand mark)
        download/wave-icon-preview.png (512, user preview)

Steps : 1) guarantee a real alpha channel (key out a baked-in checkerboard if
           the PNG has none)  2) drop the watermark row-band  3) trim  4) recolor
           artwork to white keeping antialias  5) composite on a midnight card
           with a soft sunset glow (matches the app's "Midnight Sunset" theme).
"""
from PIL import Image
import numpy as np
import os

SRC = "/home/z/my-project/upload/pasted_image_1793078438209.png"
APP = "/home/z/my-project/src/app"
PUB = "/home/z/my-project/public"
DL = "/home/z/my-project/download"

for d in (APP, PUB, DL):
    os.makedirs(d, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
W, H = img.size
a = np.array(img)
print("source:", img.size, "mode:", img.mode)

# ── 1) alpha ────────────────────────────────────────────────────────────────
alpha = a[..., 3]
transparent_ratio = float((alpha < 5).mean())
print(f"transparent px: {transparent_ratio:.2%}")
if transparent_ratio < 0.10:
    # checkerboard is baked into RGB — key light checker pixels out by luminance
    lum = a[..., :3].mean(axis=2)
    t = np.clip((lum - 70.0) / (185.0 - 70.0), 0.0, 1.0)
    a[..., 3] = ((1.0 - t) * 255).astype(np.uint8)
    print("baked checkerboard detected -> keyed by luminance")

# ── 2) drop the watermark band ──────────────────────────────────────────────
rowc = (a[..., 3] > 24).sum(axis=1)
bands, in_band, start = [], False, 0
for y, c in enumerate(rowc):
    if c > 0 and not in_band:
        start, in_band = y, True
    elif c == 0 and in_band:
        bands.append((start, y))
        in_band = False
if in_band:
    bands.append((start, H))
print("content row-bands:", bands)

if len(bands) >= 2:
    main = max(bands, key=lambda b: int(rowc[b[0]:b[1]].sum()))
    dropped = [b for b in bands if b != main]
    print(f"keeping band {main}; dropped bands (watermark etc.): {dropped}")
else:
    top, end = bands[0]
    thr = max(1, int(rowc.max() * 0.28))
    while end > top and rowc[end - 1] < thr:
        end -= 1
    main = (top, end)
    print("single band; bottom-shaved to", main)

# ── 3) trim ─────────────────────────────────────────────────────────────────
art = a[main[0]:main[1]]
ys, xs = np.where(art[..., 3] > 24)
art = art[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
ah, aw = art.shape[:2]
print(f"trimmed artwork: {aw}x{ah}")

# ── 4) recolor to white (keeps antialiasing via alpha) ──────────────────────
white = np.zeros_like(art)
white[..., :3] = 255
white[..., 3] = art[..., 3]
art_img = Image.fromarray(white, "RGBA")

# ── 5) midnight card + sunset glow ─────────────────────────────────────────
S = 512
yy = np.linspace(0.0, 1.0, S)[:, None, None]
top_c = np.array([22, 17, 34], float)   # #161122
bot_c = np.array([10, 10, 16], float)   # #0a0a10
bg = top_c[None, None, :] + (bot_c - top_c)[None, None, :] * yy

xx = np.linspace(-1, 1, S)[None, :]
yyr = np.linspace(-1, 1, S)[:, None]
r = np.sqrt((xx * 1.0) ** 2 + ((yyr - 0.22) * 1.12) ** 2)  # glow slightly below center
glow = np.clip(1.0 - r / 0.92, 0.0, 1.0) ** 2.2
bg = bg + glow[..., None] * (np.array([255, 107, 74], float) * 0.20)[None, None, :]
r2 = np.sqrt((xx + 0.45) ** 2 + ((yyr + 0.35) * 1.2) ** 2)  # faint magenta hint, top-left
glow2 = np.clip(1.0 - r2 / 0.85, 0.0, 1.0) ** 2.4
bg = bg + glow2[..., None] * (np.array([244, 61, 140], float) * 0.10)[None, None, :]
icon = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

# fit artwork: aim for 86% width, but never exceed 60% height
scale = min((S * 0.86) / aw, (S * 0.60) / ah)
nw, nh = max(1, int(aw * scale)), max(1, int(ah * scale))
art_fit = art_img.resize((nw, nh), Image.LANCZOS)
icon.alpha_composite(art_fit, ((S - nw) // 2, (S - nh) // 2))
print(f"icon artwork placed at {nw}x{nh} (scale {scale:.3f})")

# ── export set ──────────────────────────────────────────────────────────────
icon.convert("RGB").save(os.path.join(DL, "wave-icon-preview.png"))
icon.save(os.path.join(APP, "icon.png"))                      # 512
icon.resize((180, 180), Image.LANCZOS).save(os.path.join(APP, "apple-icon.png"))
icon.save(os.path.join(APP, "favicon.ico"),
          sizes=[(16, 16), (32, 32), (48, 48)])
icon.resize((256, 256), Image.LANCZOS).save(os.path.join(PUB, "wave-mark.png"))

for p in ("src/app/icon.png", "src/app/apple-icon.png", "src/app/favicon.ico",
          "public/wave-mark.png", "download/wave-icon-preview.png"):
    fp = os.path.join("/home/z/my-project", p)
    print(f"{p}: {os.path.getsize(fp)/1024:.1f} KB")
print("DONE")
