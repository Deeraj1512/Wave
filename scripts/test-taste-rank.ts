/**
 * E2E taste test with the REAL production chain:
 *   searchOriginals (live YTM) → apiTrackToTrack → tasteRank (new rule)
 * Profile: a Telugu-heavy listener who also plays some Tamil (Sai Abhyankkar)
 * and has NEVER played an English song — exactly the user's described taste.
 */
import { searchOriginals } from "../src/lib/yt/search";
import { apiTrackToTrack, tasteRank } from "../src/lib/api";
import { recordPlay } from "../src/lib/history";
import { detectTrackLang } from "../src/lib/langs";

// ── seed a realistic listening profile (the real history module, in-memory) ──
const T = Date.now();
const plays = [
  { id: "h01", title: "Chitti", artist: "Ram Miriyala", at: T - 1 * 36e5, lang: "Telugu" },
  { id: "h02", title: "Butta Bomma", artist: "Armaan Malik", at: T - 2 * 36e5, lang: "Telugu" },
  { id: "h03", title: "Samajavaragamana", artist: "Sid Sriram", at: T - 3 * 36e5, lang: "Telugu" },
  { id: "h04", title: "Ninnu Chusi", artist: "Sid Sriram", at: T - 4 * 36e5, lang: "Telugu" },
  { id: "h05", title: "Kurchi Madathapetti", artist: "Sid Sriram", at: T - 5 * 36e5, lang: "Telugu" },
  { id: "h06", title: "Sitaram", artist: "Anurag Kulkarni", at: T - 6 * 36e5, lang: "Telugu" },
  { id: "h07", title: "Inthandham", artist: "Sid Sriram", at: T - 7 * 36e5, lang: "Telugu" },
  { id: "h08", title: "Veezha Veera", artist: "Sai Abhyankkar", at: T - 8 * 36e5, lang: "Tamil" },
  { id: "h09", title: "Katchi Sera", artist: "Sai Abhyankkar", at: T - 9 * 36e5, lang: "Tamil" },
];
for (let round = 0; round < 3; round++) for (const p of plays) recordPlay(p);

// ── live search + taste rank ──
const r = await searchOriginals("Veezha");
const tracks = r.tracks.map(apiTrackToTrack);
const rels = r.tracks.map((t) => t.rel ?? 0);
const ranked = tasteRank(tracks, rels);

console.log(`search "Veezha" → ${ranked.length} tracks (attempts: ${r.attempts.join(" → ")})`);
console.log("\n── FINAL ORDER the user sees (new taste rule, Telugu-heavy profile) ──");
for (const [i, t] of ranked.entries()) {
  const famArtist = t.artist.toLowerCase().includes("sai abhyankkar") ? " ★user-artist" : "";
  console.log(
    `${String(i + 1).padStart(2)}. lang=${(t.lang ?? "?").padEnd(9)} ${String(t.plays).padStart(9)} plays  "${t.title.slice(0, 52)}"  —  ${t.artist.slice(0, 44)}${famArtist}`
  );
}

// ── sanity: the typed song must be #1, nothing foreign above Indian ──
const first = ranked[0];
const okFirst = first.title.startsWith("Veezha Veera");
const firstForeign = ranked.findIndex((t) => t.lang === "English");
const firstIndianIdx = ranked.findIndex((t) => t.lang && t.lang !== "English");
const barrierOk = firstForeign === -1 || firstForeign > firstIndianIdx || firstIndianIdx === -1;
console.log(`\ntyped song #1:            ${okFirst ? "PASS" : "FAIL"} (${first.title.slice(0, 40)})`);
console.log(`language barrier intact:  ${barrierOk ? "PASS" : "FAIL"}`);
console.log(`English rows in results:  ${ranked.filter((t) => t.lang === "English").length}`);
