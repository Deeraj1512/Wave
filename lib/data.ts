/**
 * Design tokens only — gradient palettes, genre/mood tile config and small formatters.
 * There is NO song data here: every track in the app comes live from the Wave backend
 * (see catalog.ts), so nothing can drift from reality or show fake content.
 */

// ── Sunset gradient palette pool ─────────────────────────────────────────────
const G = {
  saffron: ["#FFB43A", "#FF5C5C"] as [string, string],
  coral: ["#FF6B4A", "#F43D8C"] as [string, string],
  magenta: ["#F43D8C", "#B537F2"] as [string, string],
  ember: ["#FF4E3A", "#FFB43A"] as [string, string],
  rose: ["#FF7AA2", "#FF4E6A"] as [string, string],
  gold: ["#FFD46B", "#FF8A3D"] as [string, string],
  violet: ["#8A4DFF", "#F43D8C"] as [string, string],
  teal: ["#2DD4BF", "#0EA5A5"] as [string, string],
  dusk: ["#6D5BFF", "#FF5C8A"] as [string, string],
  monsoon: ["#4FACFE", "#5B6BFF"] as [string, string],
  forest: ["#34D399", "#059669"] as [string, string],
  henna: ["#C04C2E", "#8A2E1F"] as [string, string],
};

export const GENRE_TILES: { name: string; colors: [string, string] }[] = [
  { name: "Bollywood", colors: G.saffron },
  { name: "Tamil", colors: G.henna },
  { name: "Telugu", colors: G.teal },
  { name: "Punjabi", colors: G.gold },
  { name: "Ghazals", colors: G.dusk },
  { name: "Devotional", colors: G.ember },
  { name: "Indie", colors: G.magenta },
  { name: "Classical", colors: G.forest },
];

export const MOOD_CHIPS = ["All", "Romance", "Energize", "Sad", "Workout", "Devotional", "Party", "Focus", "Road trip", "Sleep"];

/** YTM's colorful mood tiles — each mood carries its own gradient identity. */
export const MOOD_COLORS: Record<string, [string, string]> = {
  All: ["#2A2A3A", "#1A1A26"],
  Romance: ["#F43D8C", "#FF5C5C"],
  Energize: ["#FFB43A", "#FF6B4A"],
  Sad: ["#9D5CFF", "#B537F2"],
  Workout: ["#FF4E3A", "#C04C2E"],
  Devotional: ["#FFD46B", "#FF8A3D"],
  Party: ["#F43D8C", "#B537F2"],
  Focus: ["#34D399", "#059669"],
  "Road trip": ["#FF7AA2", "#FF4E6A"],
  Sleep: ["#4A4A5A", "#2A2A3A"],
};

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Palette export for API-mapped tracks ─────────────────────────────────────
export const PALETTE: [string, string][] = Object.values(G);

/** Deterministic gradient pair for any seed (videoId). */
export function colorFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
