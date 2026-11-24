#!/usr/bin/env python3
"""Simulate what the phone launcher actually renders from the current icon set,
at realistic launcher sizes, and save side-by-side previews."""
from PIL import Image, ImageDraw
import os

RES = "/home/z/my-project/android/app/src/main/res"
D = "mipmap-xxxhdpi"

bg = Image.open(os.path.join(RES, D, "ic_launcher_background.png")).convert("RGBA")
fg = Image.open(os.path.join(RES, D, "ic_launcher_foreground.png")).convert("RGBA")
legacy = Image.open(os.path.join(RES, D, "ic_launcher.png")).convert("RGBA")
design = Image.open("/home/z/my-project/src/app/icon.png").convert("RGBA")

C = bg.size[0]  # 432

def circle_mask(im):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).ellipse([0, 0, im.size[0], im.size[1]], fill=255)
    o = im.copy(); o.putalpha(m); return o

def squircle_mask(im, radius_ratio=0.28):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                        radius=int(im.size[0] * radius_ratio), fill=255)
    o = im.copy(); o.putalpha(m); return o

def at(im, size):
    return im.resize((size, size), Image.LANCZOS)

comp = Image.alpha_composite(bg, fg)  # what adaptive icon = bg + fg

panels = [
    ("design", at(design, 240)),
    ("adaptive-circle-120px", at(circle_mask(comp), 120)),
    ("adaptive-circle-192px", at(circle_mask(comp), 192)),
    ("legacy-120px", at(legacy, 120)),
]
W = sum(p.size[0] for _, p in panels) + 10 * (len(panels) + 1)
H = max(p.size[1] for _, p in panels) + 20
sheet = Image.new("RGBA", (W, H), (20, 20, 20, 255))
x = 10
for _, p in panels:
    sheet.paste(p, (x, (H - p.size[1]) // 2), p)
    x += p.size[0] + 10
out = "/home/z/my-project/scripts/icon_sim.png"
sheet.save(out)
print("wrote", out, sheet.size)
