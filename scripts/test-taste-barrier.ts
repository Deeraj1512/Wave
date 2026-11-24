/**
 * FULL taste-barrier E2E with the real production code:
 *   - catalog mocked with a REAL one (built from the same seed searches the app runs)
 *   - history seeded via the real recordPlay
 *   - live YTM search for "Veezha"
 *   - apiTrackToTrack + tasteRank (new language-barrier rule)
 * Plus a synthetic English-junk row with a strong query match, to prove the
 * user's exact complaint ("English songs on top should not happen") is dead.
 */
import { mock } from "bun:test";
import type { Track } from "../src/lib/types";
import { searchOriginals } from "../src/lib/yt/search";
import { apiTrackToTrack, tasteRank } from "../src/lib/api";
import { recordPlay } from "../src/lib/history";

// ── 1. catalog mock (filled below, before any inferLiveLang call) ──
let cat: Track[] = [];
mock.module("../src/lib/catalog", () => ({
  catalogNow: () => cat,
  catalogTracks: () => Promise.resolve(cat),
}));

// ── 2. build the catalog exactly like the app does (seed searches + lang tag) ──
const SEEDS: Array<{ q: string; lang: Track["lang"] }> = [
  { q: "top bollywood hits", lang: "Hindi" },
  { q: "arijit singh songs", lang: "Hindi" },
  { q: "tamil hit songs", lang: "Tamil" },
  { q: "telugu hit songs", lang: "Telugu" },
  { q: "punjabi hits", lang: "Punjabi" },
  { q: "kannada hit songs", lang: "Kannada" },
  { q: "malayalam hit songs", lang: "Malayalam" },
  { q: "hindi indie songs", lang: "Hindi" },
];
for (const { q, lang } of SEEDS) {
  try {
    const r = await searchOriginals(q);
    for (const t of r.tracks.slice(0, 20)) {
      const tr = apiTrackToTrack(t);
      if (!tr.lang) tr.lang = lang;
      cat.push(tr);
    }
  } catch {
    /* seed attempt failed — continue */
  }
}
console.log(`catalog seeded: ${cat.length} tracks`);

// ── 3. listening profile: Telugu-heavy + some Tamil, ZERO English ──
const T = Date.now();
const plays = [
  { id: "h01", title: "Chitti", artist: "Ram Miriyala", lang: "Telugu" },
  { id: "h02", title: "Butta Bomma", artist: "Armaan Malik", lang: "Telugu" },
  { id: "h03", title: "Samajavaragamana", artist: "Sid Sriram", lang: "Telugu" },
  { id: "h04", title: "Ninnu Chusi", artist: "Sid Sriram", lang: "Telugu" },
  { id: "h05", title: "Inthandham", artist: "Sid Sriram", lang: "Telugu" },
  { id: "h06", title: "Veezha Veera", artist: "Sai Abhyankkar", lang: "Tamil" },
  { id: "h07", title: "Katchi Sera", artist: "Sai Abhyankkar", lang: "Tamil" },
];
for (let round = 0; round < 3; round++) for (const p of plays) recordPlay({ ...p, at: T - round * 36e5 });

// ── 4. the search the user ran + one synthetic English trap row (strong rel) ──
const r = await searchOriginals("Veezha");
let tracks = r.tracks.map(apiTrackToTrack);
let rels = r.tracks.map((t) => t.rel ?? 0);
// the junk the OLD app showed on top ("VEEZ IN THE TRAP!") — strong partial match,
// English, never listened to
tracks.push({
  id: "junkEN", title: "VEEZ IN THE TRAP!", artist: "Major Carter & Detta!", album: "Single",
  duration: 200, lang: "English", year: 0, plays: "1.2M", colors: ["#111", "#333"] as [string, string],
});
rels.push(3563); // ~bucket 2 — stronger than most Indian partial matches

const ranked = tasteRank(tracks, rels);

console.log(`\nsearch "Veezha" → ${ranked.length} rows ranked\n── FINAL ORDER (new rule) ──`);
for (const [i, t] of ranked.slice(0, 16).entries()) {
  const star = t.artist.toLowerCase().includes("sai abhyankkar") ? "  ★user-artist" : "";
  console.log(`${String(i + 1).padStart(2)}. lang=${(t.lang ?? "?").padEnd(9)} ${t.plays.padStart(8)}  "${t.title.slice(0, 46)}" — ${t.artist.slice(0, 40)}${star}`);
}
const junkPos = ranked.findIndex((t) => t.id === "junkEN");
const indianPos = ranked.findIndex((t) => t.lang && t.lang !== "English");
const firstPos = ranked[0];
console.log(`\n#1 is the typed song:        ${firstPos.title.startsWith("Veezha Veera") ? "PASS" : "FAIL"}`);
console.log(`English junk position:       #${junkPos + 1} of ${ranked.length}`);
console.log(`first Indian row position:   #${indianPos + 1}`);
console.log(`barrier (junk BELOW Indian): ${junkPos > indianPos ? "PASS" : "FAIL"}`);
console.log(`\n── last 5 rows (the sink) ──`);
for (const [i, t] of ranked.slice(-5).entries()) {
  console.log(`${ranked.length - 5 + i + 1}. lang=${(t.lang ?? "?").padEnd(9)} "${t.title.slice(0, 46)}" — ${t.artist.slice(0, 40)}`);
}
