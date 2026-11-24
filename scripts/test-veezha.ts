/**
 * Live trace: what does the CURRENT shipped code return for "Veezha"?
 * Prints order + rel + tier + views for every track, then simulates tasteRank
 * with a pure-Telugu listening profile (the user's case).
 */
import { searchOriginals } from "../src/lib/yt/search";

const r = await searchOriginals("Veezha");
console.log(`attempts: ${r.attempts.join(" → ")}   tracks: ${r.tracks.length}   albums: ${r.albums.length}`);
console.log("\n── server order (relevanceRank) with rel ──");
for (const [i, t] of r.tracks.entries()) {
  console.log(
    `${String(i + 1).padStart(2)}. rel=${String(Math.round(t.rel ?? 0)).padStart(5)}  tier=${t.tier}  views=${String(t.views).padStart(9)}  "${t.title}"  —  ${t.artist}`
  );
}

// ── simulate client tasteRank (current logic) with a Telugu-only profile ──
console.log("\n── current tasteRank simulation (Telugu-only taste) ──");
const bucket = (rel: number) => (rel >= 9000 ? 4 : rel >= 4500 ? 3 : rel >= 1800 ? 2 : rel > 0 ? 1 : 0);
const langW = new Map([["telugu", 50]]);
const scored = r.tracks.map((t, i) => ({
  t,
  relB: bucket(t.rel ?? 0),
  lang: t.album ?? "",
  views: t.views,
  i,
}));
// detect language the way detectTrackLang would for these rows (title heuristic is
// unavailable here; use artist/movie heuristics: treat non-Latin-script titles as native)
scored.sort((a, b) => b.relB - a.relB || b.views - a.views || a.i - b.i);
for (const [i, s] of scored.entries()) {
  console.log(`${String(i + 1).padStart(2)}. relB=${s.relB}  "${s.t.title}"  —  ${s.t.artist}`);
}
