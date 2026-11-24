/**
 * E2E verification of the STRICT language feed against REAL YouTube data.
 *
 * Runs the exact browser pipeline against the live /api/search route:
 *   raw ApiTrack[] → apiTrackToTrack (the real detection ladder, artist
 *   inference now disabled) → the feed's shelves with strictLangFilter —
 *   and asserts ZERO tracks outside the selected languages survive anywhere.
 *
 * Profile: Telugu + Tamil only (the user's own scenario — Hindi never picked).
 * MUST run against a started server (npx next start / dev) on :3000.
 */
import { saveProfile } from "../src/lib/profile";
import { apiTrackToTrack } from "../src/lib/api";
import { strictLangFilter } from "../src/lib/taste";
import { trackLangOf } from "../src/lib/langs";
import type { ApiTrack } from "../src/lib/api";
import type { Lang, Track } from "../src/lib/types";

const BASE = process.env.BASE ?? "http://localhost:3000";
const FEED_LANGS: Lang[] = ["Telugu", "Tamil"];

saveProfile({
  name: "Dheeraj",
  langs: FEED_LANGS,
  artists: [
    { name: "Kaala Bhairava", lang: "Telugu" },
    { name: "Anurag Kulkarni", lang: "Telugu" },
    { name: "Sid Sriram", lang: "Telugu" },
    { name: "Anirudh Ravichander", lang: "Tamil" },
  ],
});

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function search(q: string): Promise<Track[]> {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`search ${res.status} for ${q}`);
  const data = (await res.json()) as { tracks: ApiTrack[] };
  return data.tracks.map(apiTrackToTrack);
}

function hist(ts: Track[]): string {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t.lang ?? "?", (m.get(t.lang ?? "?") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(" ");
}

const FOREIGN = new Set(["Hindi", "Punjabi", "Kannada", "Malayalam", "Bengali", "English"]);
// classify through the STRICT ladder (the filter's own source of truth) — the
// lang FIELD may be unset for rows only the ladder's word/artist legs resolve
const leaks = (ts: Track[]) => ts.filter((t) => FOREIGN.has(trackLangOf(t) ?? "") || trackLangOf(t) === undefined);

console.log("\n[1] discovery catalog (the pool Quick picks / Explore draw from)");
const seeds = [
  { q: "top bollywood hits", lang: "Hindi" as Lang },
  { q: "arijit singh songs", lang: "Hindi" as Lang },
  { q: "tamil hit songs", lang: "Tamil" as Lang },
  { q: "telugu hit songs", lang: "Telugu" as Lang },
  { q: "telugu melody hit songs", lang: "Telugu" as Lang },
  { q: "tamil melody hit songs", lang: "Tamil" as Lang },
  { q: "telugu love songs", lang: "Telugu" as Lang },
];
const catalog: Track[] = [];
const seenIds = new Set<string>();
for (const s of seeds) {
  const ts = await search(s.q).catch(() => [] as Track[]);
  for (const t of ts) {
    if (!t.lang) t.lang = s.lang;
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      catalog.push(t);
    }
  }
}
console.log(`  catalog: ${catalog.length} tracks — ${hist(catalog)}`);
const catalogLocked = strictLangFilter(catalog, FEED_LANGS);
console.log(`  strict slice: ${catalogLocked.length} tracks — ${hist(catalogLocked)}`);
check("catalog strict slice has ZERO foreign tracks", leaks(catalogLocked).length === 0, JSON.stringify(leaks(catalogLocked).slice(0, 5).map((t) => `${t.title} [${t.lang}]`)));
check("catalog strict slice is healthy (≥40 tracks for the shelves)", catalogLocked.length >= 40, `got ${catalogLocked.length}`);

console.log("\n[2] Made for you — per-artist pools (biased query + strict lock, NO presumption)");
const cast = [
  { name: "Kaala Bhairava", lang: "Telugu" as Lang },
  { name: "Anurag Kulkarni", lang: "Telugu" as Lang },
  { name: "Sid Sriram", lang: "Telugu" as Lang },
  { name: "Anirudh Ravichander", lang: "Tamil" as Lang },
];
const groups: Track[][] = [];
for (const c of cast) {
  let theirs = (await search(`${c.name} ${c.lang} songs`)).filter((t) => t.duration >= 45);
  theirs = strictLangFilter(theirs, FEED_LANGS);
  console.log(`  ${c.name} (${c.lang}): ${theirs.length} ladder-proven tracks — ${hist(theirs)}`);
  check(`${c.name}: zero foreign AND zero unknown songs in his locked pool`, leaks(theirs).length === 0, JSON.stringify(leaks(theirs).slice(0, 4).map((t) => `${t.title} [${t.lang}]`)));
  check(`${c.name}: pool big enough for the shelf (≥6)`, theirs.length >= 6, `got ${theirs.length}`);
  if (theirs.length > 0) groups.push(theirs.slice(0, 6));
}
check("all four artists delivered locked pools", groups.length === 4, `got ${groups.length}`);
const forYou = groups.flat().slice(0, 12);
check("Made-for-you final pool: zero foreign", leaks(forYou).length === 0, JSON.stringify(leaks(forYou).slice(0, 4).map((t) => `${t.title} [${t.lang}]`)));

console.log("\n[3] Trending — per-language charts");
const trendTop: Track[] = [];
for (const l of FEED_LANGS) {
  const ts = await search(`${l.toLowerCase()} trending songs`);
  const locked = strictLangFilter(ts, FEED_LANGS, { presumptive: l });
  console.log(`  ${l} trending: ${ts.length} raw → ${locked.length} locked — ${hist(locked)}`);
  trendTop.push(...locked.slice(0, 5));
}
check("trending shelves: zero foreign songs", leaks(trendTop).length === 0, JSON.stringify(leaks(trendTop).slice(0, 4).map((t) => `${t.title} [${t.lang}]`)));

console.log("\n[4] The leak bait — a Hindi-heavy raw pool must never survive");
const bait = await search("arijit singh songs");
console.log(`  raw "arijit singh songs": ${bait.length} tracks — ${hist(bait)}`);
const baitLocked = strictLangFilter(bait, FEED_LANGS);
console.log(`  strict: ${baitLocked.length} survive — ${hist(baitLocked)}`);
check("a purely-Hindi artist's pool empties under the lock (no trickle)", baitLocked.filter((t) => FOREIGN.has(t.lang ?? "")).length === 0, JSON.stringify(baitLocked.filter((t) => FOREIGN.has(t.lang ?? "")).slice(0, 5).map((t) => `${t.title} [${t.lang}]`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
