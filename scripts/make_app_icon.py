#!/usr/bin/env python3
"""Wave app icon — original vector artwork.

Concept (from the user's reference): a crimson eighth note wrapped by two
concentric sound-wave arcs. Redrawn from scratch as clean vectors, adapted to
Wave's dark design language (#030303 world, white accents, red brand touch).

Outputs:
  src/app/icon.png        512x512 rounded tile (favicon / general)
  src/app/apple-icon.png  180x180 full-bleed square (iOS masks its own corners)
  src/app/favicon.ico     16/32/48 multi-size
  public/wave-mark.png    256x256 rounded tile (sidebar brand mark)
"""

import math
import os
import cairosvg
from PIL import Image

ROOT = "/home/z/my-project"
OUT_APP = os.path.join(ROOT, "src", "app")
OUT_PUB = os.path.join(ROOT, "public")

# ── master geometry (viewBox 0 0 512 512) ────────────────────────────────────
HEAD = (296.0, 310.0)     # note-head center
HEAD_RX, HEAD_RY = 60.0, 47.0
HEAD_ROT = -18.0
STEM_W = 26.0             # stem spans [330, 356], rises to y=92
STEM_TOP = 92.0
ARC_IN_R, ARC_IN_W = 115.0, 33.0
ARC_OUT_R, ARC_OUT_W = 168.0, 37.0


def pol(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def arc_path(cx, cy, r, a_start, a_end):
    """Arc from a_start to a_end travelling counterclockwise on screen
    (through the bottom when a_start=210 -> a_end=20)."""
    sx, sy = pol(cx, cy, r, a_start)
    ex, ey = pol(cx, cy, r, a_end)
    span = (a_start - a_end) % 360  # ccw span in this parametrization
    large = 1 if span > 180 else 0
    return f"M {sx:.1f} {sy:.1f} A {r:.0f} {r:.0f} 0 {large} 0 {ex:.1f} {ey:.1f}"


def build_svg(radius: float) -> str:
    """radius: tile corner radius (0 = full-bleed square)."""
    hx, hy = HEAD
    inner = arc_path(hx, hy, ARC_IN_R, 210, 20)
    outer = arc_path(hx, hy, ARC_OUT_R, 200, 45)
    # note head: ellipse rotated; stem: rect overlapping head's right side;
    # flag: swoosh from stem top bulging right, tapering to a tip low-right.
    stem_left = f"{hx + HEAD_RX - 26:.0f}"
    stem_right = f"{hx + HEAD_RX:.0f}"
    note = (
        f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}" '
        f'transform="rotate({HEAD_ROT} {hx} {hy})"/>'
        f'<rect x="{stem_left}" y="{STEM_TOP}" width="{STEM_W}" '
        f'height="{hy - STEM_TOP + 6:.0f}"/>'
        f'<path d="M {stem_left} {STEM_TOP} L {stem_right} {STEM_TOP} '
        f'C 428 96 470 148 456 252 '
        f'C 438 204 398 180 {stem_left} 176 Z"/>'
    )
    return f"""<svg width="512" height="512" viewBox="0 0 512 512"
  xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1d24"/>
      <stop offset="1" stop-color="#0a0a0e"/>
    </linearGradient>
    <linearGradient id="note" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff4545"/>
      <stop offset="1" stop-color="#c90000"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.58" cy="0.63" r="0.55">
      <stop offset="0" stop-color="#ff0000" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#ff0000" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="tile">
      <rect width="512" height="512" rx="{radius}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="512" fill="url(#glow)"/>
    <path d="{outer}" fill="none" stroke="#ffffff" stroke-opacity="0.28"
      stroke-width="{ARC_OUT_W}" stroke-linecap="round"/>
    <path d="{inner}" fill="none" stroke="#ffffff" stroke-opacity="0.5"
      stroke-width="{ARC_IN_W}" stroke-linecap="round"/>
    <g fill="url(#note)">{note}</g>
  </g>
</svg>"""


def render(radius: float, px: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=build_svg(radius).encode(), output_width=px, output_height=px)
    import io
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main():
    os.makedirs(OUT_APP, exist_ok=True)
    os.makedirs(OUT_PUB, exist_ok=True)

    # preview sheet (4 variants) for visual check
    sheet = Image.new("RGBA", (512 * 2 + 30, 512 + 190 + 30), (40, 40, 46, 255))
    rounded = render(116, 512)
    square = render(0, 512)
    sheet.paste(rounded, (0, 0), rounded)
    sheet.paste(square, (542, 0), square)
    for i, px in enumerate((64, 48, 32, 16)):
        small = render(116, px)
        sheet.paste(small, (20 + i * 70, 542), small)
    sheet.save(os.path.join(ROOT, "scripts", "icon_preview.png"))

    # deliverables — high-res renders straight from the vector master
    render(116, 1024).save(os.path.join(OUT_APP, "icon.png"))
    render(0, 180).save(os.path.join(OUT_APP, "apple-icon.png"))
    render(116, 512).save(os.path.join(OUT_PUB, "wave-mark.png"))
    # favicon: one vector-rendered frame per size (crisper than downscaling)
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    frames = {s[0]: render(96, s[0]) for s in ico_sizes}
    frames[256].save(
        os.path.join(OUT_APP, "favicon.ico"),
        sizes=ico_sizes,
        append_images=[frames[s[0]] for s in ico_sizes if s[0] != 256],
    )
    # 4K masters for the user (rounded app tile + full-bleed square)
    dl = os.path.join(ROOT, "download")
    os.makedirs(dl, exist_ok=True)
    render(116, 4096).save(os.path.join(dl, "wave-icon-4k.png"))
    render(0, 4096).save(os.path.join(dl, "wave-icon-4k-square.png"))
    print("icon files written")


if __name__ == "__main__":
    main()
