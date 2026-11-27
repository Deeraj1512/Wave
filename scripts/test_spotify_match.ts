/**
 * OFFLINE matcher test — no network, targets the ACTIVE matcher (match.ts,
 * the client-side one the app ships). Validates scoreHit() thresholds against
 * realistic Spotify-track → YTM-candidate pairs drawn from the Indian market
 * (Telugu/Hindi film songs, "- Topic" uploads, jukeboxes, nightcore, 1-hour
 * loops). Run: bun run scripts/test_spotify_match.ts — exits 1 on any failure.
 *
 * scoreHit contract under test:
 *   null            → hard reject (duration beyond rescue / not the song)
 *   number ≥ 48     → accepted (best candidate wins)
 *   number < 48     → below the acceptance bar (ships UNMATCHED)
 */

import { scoreHit, type SpMatchInput } from "../src/lib/spotify/match";

interface Case {
  label: string;
  sp: SpMatchInput;
  hit: { videoId: string; title: string; artist: string; album: string; durationSec: number; views: number; tier: number };
  expect: "accept" | "nomatch";
}

const cases: Case[] = [
  // ── accepts ────────────────────────────────────────────────────────────────
  {
    label: "exact YTM original (ATV tier 1, same duration)",
    sp: { id: "sp1", name: "Nee Kannu Neeli Samudram", durationMs: 268_000, artists: ["Anirudh Ravichander", "Dhanush"] },
    hit: { videoId: "abc", title: "Nee Kannu Neeli Samudram", artist: "Anirudh Ravichander - Topic", album: "Uppena", durationSec: 267, views: 4_000_000, tier: 1 },
    expect: "accept",
  },
  {
    label: "official audio upload with noise in the title",
    sp: { id: "sp2", name: "Butta Bomma", durationMs: 226_000, artists: ["Armaan Malik"] },
    hit: { videoId: "def", title: "Butta Bomma Video Song | Ala Vaikunthapurramuloo | Official Video 4K", artist: "Aditya Music", album: "Ala Vaikunthapurramuloo", durationSec: 228, views: 900_000_000, tier: 2 },
    expect: "accept",
  },
  {
    label: "Spotify movie-tail cleaned, containment artist",
    sp: { id: "sp3", name: "Kurchi Madathapetti (From \"Guntur Kaaram\")", durationMs: 252_000, artists: ["Thaman S", "Sid Sriram"] },
    hit: { videoId: "ghi", title: "Kurchi Madathapetti (From 'Guntur Kaaram') Lyrical", artist: "Thaman S - Topic", album: "Guntur Kaaram", durationSec: 253, views: 300_000_000, tier: 1 },
    expect: "accept",
  },
  {
    label: "±5s duration window, overlapping title tokens",
    sp: { id: "sp4", name: "Samajavaragamana", durationMs: 245_000, artists: ["Sid Sriram"] },
    hit: { videoId: "jkl", title: "Samajavaragamana Full Song", artist: "Aditya Music", album: "Ala Vaikunthapurramuloo", durationSec: 249, views: 200_000_000, tier: 2 },
    expect: "accept",
  },
  {
    label: "jukebox-time title but per-track duration match",
    sp: { id: "sp5", name: "Rangamma Mangamma", durationMs: 214_000, artists: ["M.M. Keeravaani"] },
    hit: { videoId: "mno", title: "Rangamma Mangamma Audio Song | Rangasthalam", artist: "Aditya Music", album: "Rangasthalam", durationSec: 216, views: 80_000_000, tier: 2 },
    expect: "accept",
  },

  // ── hard rejects (null) ────────────────────────────────────────────────────
  {
    label: "1-hour loop upload",
    sp: { id: "sp6", name: "Nee Kannu Neeli Samudram", durationMs: 268_000, artists: ["Anirudh Ravichander"] },
    hit: { videoId: "r1", title: "Nee Kannu Neeli Samudram 1 Hour Loop", artist: "Loop Zone", album: "", durationSec: 3600, views: 50_000, tier: 3 },
    expect: "nomatch",
  },
  {
    label: "full album jukebox (20 min)",
    sp: { id: "sp7", name: "Butta Bomma", durationMs: 226_000, artists: ["Armaan Malik"] },
    hit: { videoId: "r2", title: "Ala Vaikunthapurramuloo Full Audio Jukebox", artist: "Aditya Music", album: "", durationSec: 1450, views: 30_000_000, tier: 3 },
    expect: "nomatch",
  },
  {
    label: "nightcore sped-up cover (duration collapse)",
    sp: { id: "sp8", name: "Samajavaragamana", durationMs: 245_000, artists: ["Sid Sriram"] },
    hit: { videoId: "r3", title: "Samajavaragamana Nightcore", artist: "Nightcore Lab", album: "", durationSec: 196, views: 900_000, tier: 3 },
    expect: "nomatch",
  },
  {
    label: "completely different song sharing one word",
    sp: { id: "sp9", name: "Nuvvunte Naa Jathaga", durationMs: 282_000, artists: ["Sid Sriram"] },
    hit: { videoId: "r4", title: "Nuvvu Navvu Nanna Chusi Nenu Full Comedy Scene", artist: "Sri Balaji Video", album: "", durationSec: 285, views: 2_000_000, tier: 3 },
    expect: "nomatch",
  },
  {
    label: "spoken podcast with the song name in it",
    sp: { id: "sp10", name: "Naatu Naatu", durationMs: 230_000, artists: ["Rahul Sipligunj", "Kaala Bhairava"] },
    hit: { videoId: "r5", title: "Interview: How We Wrote Naatu Naatu | Keeravaani", artist: "Film Companion", album: "", durationSec: 232, views: 400_000, tier: 3 },
    expect: "nomatch",
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const s = scoreHit(c.sp, c.hit);
  const kind = s === null ? "nomatch" : s >= 48 ? "accept" : "nomatch";
  const ok = kind === c.expect;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}: score=${s === null ? "null" : s.toFixed(1)} (${kind}, expected ${c.expect})`);
}

// Acceptance bar sanity: a top-tier exact match must clear the bar by a margin.
const margin = scoreHit(
  { id: "m", name: "Butta Bomma", durationMs: 226_000, artists: ["Armaan Malik"] },
  { videoId: "x", title: "Butta Bomma", artist: "Armaan Malik - Topic", album: "Ala Vaikunthapurramuloo", durationSec: 226, views: 9e8, tier: 1 }
);
if (margin !== null && margin >= 70) {
  pass++;
  console.log(`PASS  perfect-match margin: score=${margin.toFixed(1)} (≥ 70)`);
} else {
  fail++;
  console.log(`FAIL  perfect-match margin: score=${margin === null ? "null" : margin.toFixed(1)} (expected ≥ 70)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
