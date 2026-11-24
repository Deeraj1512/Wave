/**
 * tasteRank ordering tests — the search-list rules the user set:
 *   exact match always tops · user's listened languages float up at equal
 *   relevance · most-played on top within a bucket · least played sink.
 * Run: bun scripts/test_search_rank2.ts
 */
const store = new Map<string, string>();
(globalThis as any).window = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};
// history needs Date.now etc. — fine in bun

const { tasteRank } = require("/home/z/my-project/src/lib/api.ts");
const { recordPlay } = require("/home/z/my-project/src/lib/history.ts");

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

const mk = (id: string, title: string, artist: string, album: string, views: number, marker: "telugu" | "hindi" | "none" = "none") => ({
  id,
  title,
  artist,
  album: marker === "telugu" ? "Telugu OST" : marker === "hindi" ? "Hindi OST" : album,
  duration: 200,
  lang: marker === "telugu" ? "Telugu" : marker === "hindi" ? "Hindi" : undefined,
  year: 0,
  plays: views >= 1e9 ? `${(views / 1e9).toFixed(1)}B` : views >= 1e6 ? `${Math.round(views / 1e6)}M` : `${Math.max(1, Math.round(views / 1e3))}K`,
  colors: ["#000", "#111"] as [string, string],
});

// the user's taste: Telugu listener (5 plays, language frozen at play time like
// the player does), zero Hindi
recordPlay({ id: "seed1", title: "Samajavaragamana", artist: "Sid Sriram", lang: "Telugu" });
recordPlay({ id: "seed2", title: "Inkem Inkem Inkem Kaavaale", artist: "Sid Sriram", lang: "Telugu" });
recordPlay({ id: "seed3", title: "Nuvvunna Chalu", artist: "Sid Sriram", lang: "Telugu" });
recordPlay({ id: "seed4", title: "Kalaavathi", artist: "Sid Sriram", lang: "Telugu" });
recordPlay({ id: "seed5", title: "Butta Bomma", artist: "Armaan Malik", lang: "Telugu" });

// an artist query: equal relevance (token overlap in artist), mixed languages
const tracks = [
  mk("big-hindi", "Tum Hi Ho", "Arijit Singh", "x", 1_200_000_000, "hindi"),
  mk("mid-hindi", "Kesariya", "Arijit Singh", "x", 974_000_000, "hindi"),
  mk("small-hindi", "Old Arijit Song", "Arijit Singh", "x", 900_000, "hindi"),
  mk("telugu-1", "Samajavaragamana Reprise", "Arijit Singh", "x", 2_000_000, "telugu"),
  mk("telugu-2", "Telugu Duet", "Arijit Singh", "x", 800_000, "telugu"),
];
const rels = tracks.map(() => 1000); // same bucket for all — taste decides
const out = tasteRank(tracks, rels);
const ids = out.map((t) => t.id);
check("listener's language first", ids[0].startsWith("telugu"), ids.join(","));
check("within a language, most-played tops", ids.slice(2, 5).join(",") === "big-hindi,mid-hindi,small-hindi", ids.join(","));
check("least played sinks to bottom", ids[ids.length - 1] === "small-hindi", ids.join(","));

// exact-match dominance: a perfect Hindi match still beats an in-language half-match
const tracks2 = [
  mk("half-telugu", "Kesariya Telugu Cover", "Arijit Singh", "x", 500_000, "telugu"),
  mk("exact-hindi", "Kesariya", "Arijit Singh", "x", 974_000_000, "hindi"),
];
const rels2 = [1000, 9500]; // exact-match bucket for the real song
const out2 = tasteRank(tracks2, rels2);
check("exact match always tops", out2[0].id === "exact-hindi", out2.map((t) => t.id).join(","));

// no taste profile (fresh install) → server order preserved
const out3 = tasteRank([mk("a", "X", "Y", "z", 100), mk("b", "W", "Z", "y", 50)], [0, 0]);
check("fresh install: order untouched", out3[0].id === "a" && out3[1].id === "b");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
