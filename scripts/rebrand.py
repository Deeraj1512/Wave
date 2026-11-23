#!/usr/bin/env python3
"""Rebrand Dhun -> Swaram + fix multibyte-visible bugs (Telugu glyphs, emojis)."""
import re, sys, pathlib

ROOT = pathlib.Path("/home/z/my-project")
results = []

def sub(path: str, old: str, new: str, count: int = 0, regex: bool = False):
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if regex:
        s2, n = re.subn(old, new, s)
    else:
        n = s.count(old)
        s2 = s.replace(old, new) if count == 0 else s.replace(old, new, count)
    p.write_text(s2, encoding="utf-8")
    results.append((path, (old[:48] + "...") if len(old) > 48 else old, n))

# Telugu strings built from codepoints to guarantee byte-exact matching
DHA = "\u0c27"                     # ధ
DHUN_DEVA = "\u0927\u0941\u0928"   # धुन (Devanagari)
SWA = "\u0c38\u0c4d\u0c35"         # స్వ
SWARAM_TEL = "\u0c38\u0c4d\u0c35\u0c30\u0c02"  # స్వరం
MIDDOT = "\u00b7"
EMDASH = "\u2014"

# ── Shell.tsx: logo glyphs (TopBar + BrandMark) and avatar glyph ──
sub("src/components/Shell.tsx",
    f'<span className="text-base font-black text-black">{DHA}</span>',
    f'<span className="text-[15px] font-black leading-none text-black">{SWA}</span>')
sub("src/components/Shell.tsx",
    f'text-sm font-black text-black shadow-md"\n        >\n          {DHA}\n        </button>',
    f'text-[13px] font-black leading-none text-black shadow-md"\n        >\n          {SWA}\n        </button>')

# ── Home.tsx: kicker brand line ──
sub("src/components/screens/Home.tsx",
    f"Dhun {MIDDOT} {DHUN_DEVA}</p>",
    f"Swaram {MIDDOT} {SWARAM_TEL}</p>")

# ── Home.tsx: strip emojis from greeting lines (optional VS16) ──
sub("src/components/screens/Home.tsx",
    r' \U0001F319\uFE0F?";', '";', regex=True)                 # 🌙 (Up late? / Good night)
sub("src/components/screens/Home.tsx",
    r' \u2600\uFE0F?";', '";', regex=True)                     # ☀️
sub("src/components/screens/Home.tsx",
    r' \U0001F324\uFE0F?";', '";', regex=True)                 # 🌤️
sub("src/components/screens/Home.tsx",
    r' \U0001F306\uFE0F?";', '";', regex=True)                 # 🌆
# ── Home.tsx: drop flag emoji from Trending heading ──
sub("src/components/screens/Home.tsx",
    r' \U0001F1EE\U0001F1F3</h2>', '</h2>', regex=True)        # 🇮🇳

# ── Cards.tsx: hide the bogus "0 ·" year prefix ──
sub("src/components/Cards.tsx",
    "{track.year} " + MIDDOT + " {track.artist}",
    '{track.year ? `${track.year} ' + MIDDOT + ' ` : ""}{track.artist}')

# ── layout.tsx: metadata title ──
sub("src/app/layout.tsx",
    f"Dhun {EMDASH} Your music, your language",
    f"Swaram {EMDASH} Your music, your language")

# ── globals.css: design-language header comment ──
sub("src/app/globals.css", "Dhun design language", "Swaram design language")

ok = True
for path, old, n in results:
    mark = "OK " if n > 0 else "MISS"
    if n == 0:
        ok = False
    print(f"[{mark}] {path}  x{n}  {old!r}")
sys.exit(0 if ok else 1)
