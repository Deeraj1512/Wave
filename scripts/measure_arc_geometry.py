#!/usr/bin/env python3
"""Measure the twin-arc geometry (center, radii, stroke, span, brightness)
in the Wave icon design, so the launcher mark can redraw them crisply."""
from PIL import Image
import numpy as np

img = Image.open("/home/z/my-project/src/app/icon.png").convert("RGBA")
a = np.asarray(img).astype(np.float32)
S = img.size[0]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
maxc = a[..., :3].max(axis=2)
minc = a[..., :3].min(axis=2)
sat = maxc - minc

# arc pixels: neutral gray, clearly brighter than the card
arc = (sat < 22) & (maxc >= 80)
ys, xs = np.nonzero(arc)
print("arc pixels:", len(xs))
print("x range", xs.min(), xs.max(), " y range", ys.min(), ys.max())

# grid-search the common center that makes the radius histogram most bimodal
best = None
for cx in range(int(S * 0.35), int(S * 0.62), 6):
    for cy in range(int(S * 0.38), int(S * 0.68), 6):
        rad = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
        hist, _ = np.histogram(rad, bins=60, range=(150, 700))
        score = np.sort(hist)[-12:].sum()  # concentration into few bins
        if best is None or score > best[0]:
            best = (score, cx, cy, hist)
score, cx, cy, hist = best
print(f"\nbest center: ({cx},{cy})  score={score}")
rad = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
hist, edges = np.histogram(rad, bins=110, range=(150, 700))
peaks = [(int(edges[i]), int(hist[i])) for i in range(110) if hist[i] > 800]
print("radius histogram peaks (radius_px, count):")
for p in peaks:
    print("  ", p)

ang = np.degrees(np.arctan2(ys - cy, xs - cx))
for lo, hi, name in [(200, 330, "inner?"), (330, 480, "middle?"), (480, 620, "outer?")]:
    sel = (rad >= lo) & (rad < hi)
    if sel.sum() > 100:
        print(f"ring {lo}-{hi}: n={int(sel.sum())} angle {np.percentile(ang[sel],2):.0f}..{np.percentile(ang[sel],98):.0f} deg, maxc {np.percentile(maxc[ys[sel],xs[sel]],50):.0f}")
