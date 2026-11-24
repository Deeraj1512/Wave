#!/usr/bin/env python3
"""Measure arc vs card-glow brightness in the icon design to pick a safe key."""
from PIL import Image
import numpy as np

img = Image.open("/home/z/my-project/src/app/icon.png").convert("RGBA")
a = np.asarray(img).astype(np.float32)
S = img.size[0]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
maxc = a[..., :3].max(axis=2)
minc = a[..., :3].min(axis=2)
sat = maxc - minc  # 0 = neutral gray, large = red-dominant

# Where is the outer arc? bottom-left region of the artwork.
# Sample the bottom-left quadrant, excluding the card (very dark).
bl = (slice(int(S * 0.35), int(S * 0.95)), slice(int(S * 0.05), int(S * 0.60)))
reg_max = maxc[bl]
reg_sat = sat[bl]

print("bottom-left quadrant maxc histogram:")
for lo in range(0, 200, 20):
    n = int(((reg_max >= lo) & (reg_max < lo + 20)).sum())
    print(f"  {lo:3d}-{lo+20:3d}: {n:7d}")

print("\nneutral pixels (sat<25) by brightness, bottom-left:")
for lo in range(30, 200, 15):
    n = int(((reg_max >= lo) & (reg_max < lo + 15) & (reg_sat < 25)).sum())
    if n:
        print(f"  maxc {lo:3d}-{lo+15:3d}: {n:7d}")

print("\nred-dominant pixels (sat>=60) by brightness, bottom-left (card glow?):")
for lo in range(30, 200, 15):
    n = int(((reg_max >= lo) & (reg_max < lo + 15) & (reg_sat >= 60)).sum())
    if n:
        print(f"  maxc {lo:3d}-{lo+15:3d}: {n:7d}")

# the current key: 80..120 ramp — how much arc mass sits under maxc 120?
under = int(((reg_max >= 40) & (reg_max < 120) & (reg_sat < 25)).sum())
over = int(((reg_max >= 120) & (reg_sat < 25)).sum())
print(f"\nneutral arc-ish pixels: dim(40-120)={under}  bright(>=120)={over}")

# current foreground as the launcher sees it: count visible arc pixels after key
alpha_reg = np.clip((reg_max - 80.0) / 40.0, 0, 1)
fg_arcs = int(((alpha_reg > 0.5) & (reg_sat < 25) & (reg_max >= 80)).sum())
print(f"arc pixels surviving current key (alpha>0.5): {fg_arcs}")
