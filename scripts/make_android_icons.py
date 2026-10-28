#!/usr/bin/env python3
"""
Wave — Android launcher icon factory.

Input : src/app/icon.png (1024×1024 "Midnight Sunset" card: red note + waves)
Output (android/app/src/main/res/):
  mipmap-*/ic_launcher.png        legacy launcher (card as-is, rounded corners)
  mipmap-*/ic_launcher_round.png  legacy round mask
  mipmap-*/ic_launcher_foreground.png  adaptive FOREGROUND (artwork in safe zone)
  mipmap-*/ic_launcher_background.png  adaptive BACKGROUND (card gradient, full bleed)
  drawable*/splash.png            launch screen: ink bg + centered mark
  values/ic_launcher_background.xml kept for pre-26 fallback color

The adaptive foreground is rebuilt by keying the dark card out of the artwork
(card pixels are all very dark; the red note and gray waves are bright), so the
mark floats on the background layer exactly like an original adaptive icon.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

RES = "/home/z/my-project/android/app/src/main/res"
SRC = "/home/z/my-project/src/app/icon.png"

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

img = Image.open(SRC).convert("RGBA")
S = img.size[0]

# ── 1) artwork-only (alpha keyed on MAX-channel brightness) ──────────────────
# The card is a dark maroon gradient (max(R,G,B) ≤ ~60) while ALL artwork is
# bright (red note ≥ ~150, gray waves ≥ ~120) — max-channel separates cleanly
# where plain luminance would eat the dark-red note head/stem.
a = np.asarray(img).astype(np.float32)
maxc = a[..., :3].max(axis=2)
# smooth ramp: ≤80 → transparent, ≥120 → opaque
alpha = np.clip((maxc - 80.0) / (120.0 - 80.0), 0.0, 1.0)
art = a.copy()
art[..., 3] = alpha * 255.0
art_img = Image.fromarray(art.astype(np.uint8), "RGBA")
# crop to the artwork's bounding box so centering is exact
bbox = art_img.getbbox()
art_img = art_img.crop(bbox)
print("artwork bbox:", bbox, "→", art_img.size)

# average card color (for the pre-26 fallback) + card gradient endpoints
solid = img.copy()
mask = Image.new("L", solid.size, 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=int(S * 0.19), fill=255)
px = np.asarray(solid)
mk = np.asarray(mask) > 0
avg = px[mk][:, :3].mean(axis=0).astype(int)
# card-only sample patches (artwork-free zones): glow-lit upper-left card + dark corner
def patch(x0: int, y0: int, side: int = 60) -> np.ndarray:
    return px[y0:y0 + side, x0:x0 + side, :3].reshape(-1, 3).mean(axis=0).astype(int)

center_patch = patch(int(S * 0.28), int(S * 0.18))   # card under the glow, above the waves
edge_patch = patch(int(S * 0.04), int(S * 0.04), 80) # dark corner
print("avg card: #%02X%02X%02X  center: #%02X%02X%02X  edge: #%02X%02X%02X"
      % (*avg, *center_patch, *edge_patch))


def radial_bg(size: int) -> Image.Image:
    """Card-like radial gradient: center tone → corner tone (matches the icon card)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    half = size / 2.0
    t = np.clip(np.sqrt((xx - half) ** 2 + (yy - half) ** 2) / (half * 1.35), 0.0, 1.0)
    out = np.zeros((size, size, 4), dtype=np.uint8)
    for ch in range(3):
        out[..., ch] = np.round(center_patch[ch] * (1 - t) + edge_patch[ch] * t)
    out[..., 3] = 255
    return Image.fromarray(out, "RGBA")

# ── 2) legacy launcher + round + adaptive layers per density ────────────────
def put(path: str, im: Image.Image) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print("wrote", path.replace(RES + "/", ""), im.size)

for name, scale in DENSITIES.items():
    d = os.path.join(RES, f"mipmap-{name}")
    legacy = int(round(48 * scale))          # 48dp launcher
    round_px = int(round(legacy))

    # legacy: the card icon as-is (its own rounded corners + transparency)
    put(os.path.join(d, "ic_launcher.png"), img.resize((legacy, legacy), Image.LANCZOS))

    # legacy round: circle mask over the full card
    r = Image.new("L", (S, S), 0)
    ImageDraw.Draw(r).ellipse([0, 0, S, S], fill=255)
    rounded = img.copy()
    rounded.putalpha(r)
    put(os.path.join(d, "ic_launcher_round.png"), rounded.resize((round_px, round_px), Image.LANCZOS))

    # adaptive canvas: 108dp; content must sit inside the inner 66dp (61.1%)
    canvas = int(round(108 * scale))
    put(os.path.join(d, "ic_launcher_background.png"), radial_bg(canvas))

    safe = int(round(canvas * 66.0 / 108.0))
    aw = int(round(safe * (art_img.size[0] / art_img.size[1])))
    ah = safe
    if aw > safe:
        aw, ah = safe, int(round(safe * (art_img.size[1] / art_img.size[0])))
    art = art_img.resize((aw, ah), Image.LANCZOS)
    fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    fg.paste(art, ((canvas - aw) // 2, (canvas - ah) // 2), art)
    put(os.path.join(d, "ic_launcher_foreground.png"), fg)

# ── 3) adaptive XMLs point at our layers ────────────────────────────────────
anydpi = os.path.join(RES, "mipmap-anydpi-v26")
os.makedirs(anydpi, exist_ok=True)
for fn in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(anydpi, fn), "w") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            "</adaptive-icon>\n"
        )
    print("wrote mipmap-anydpi-v26/" + fn)

# pre-26 fallback color behind the card
with open(os.path.join(RES, "values", "ic_launcher_background.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            + f'    <color name="ic_launcher_background">#{avg[0]:02X}{avg[1]:02X}{avg[2]:02X}</color>\n'
            + "</resources>\n")
print("wrote values/ic_launcher_background.xml")

# ── 4) splash screens: ink bg + centered mark ───────────────────────────────
INK = (3, 3, 5, 255)  # app bg #030303
MARK_H_RATIO = 0.16   # mark height relative to the screen's short side

def splash(w: int, h: int) -> Image.Image:
    s = Image.new("RGBA", (w, h), INK)
    mh = int(round(min(w, h) * MARK_H_RATIO))
    mw = int(round(mh * (art_img.size[0] / art_img.size[1])))
    m = art_img.resize((mw, mh), Image.LANCZOS)
    # soft glow under the mark
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gm = Image.new("RGBA", (mw * 3, mh * 3), (0, 0, 0, 0))
    gm.paste(Image.new("RGBA", (mw, mh), (220, 38, 38, 70)), (mw, mh), m)
    gm = gm.filter(ImageFilter.GaussianBlur(mh // 2))
    glow.paste(gm, ((w - gm.size[0]) // 2, (h - gm.size[1]) // 2), gm)
    s = Image.alpha_composite(s, glow)
    s.paste(m, ((w - mw) // 2, (h - mh) // 2), m)
    return s

splashes = {
    "drawable/splash.png": (480, 320),
    "drawable-land-mdpi/splash.png": (480, 320),
    "drawable-land-hdpi/splash.png": (800, 480),
    "drawable-land-xhdpi/splash.png": (960, 720),
    "drawable-land-xxhdpi/splash.png": (1600, 960),
    "drawable-land-xxxhdpi/splash.png": (1920, 1280),
    "drawable-port-mdpi/splash.png": (320, 480),
    "drawable-port-hdpi/splash.png": (480, 800),
    "drawable-port-xhdpi/splash.png": (720, 960),
    "drawable-port-xxhdpi/splash.png": (960, 1600),
    "drawable-port-xxxhdpi/splash.png": (1280, 1920),
}
for rel, (w, h) in splashes.items():
    put(os.path.join(RES, rel), splash(w, h))

print("\nDone — Android icon set generated.")
