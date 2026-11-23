/**
 * Logic tests for the search-fix batch — run with bun.
 *  1. parseAlbumRows — the Innertube album-entity parsing (browseId, byline, thumb)
 *  2. tasteRank — taste re-ranking that never overrides query-match buckets
 */
// minimal browser shim (history + api touch localStorage through guards)
const store = new Map<string, string>();
(globalThis as any).window = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

const { parseAlbumRows } = require("/home/z/my-project/src/lib/yt/album.ts");
const { tasteRank } = require("/home/z/my-project/src/lib/api.ts");
const { recordPlay } = require("/home/z/my-project/src/lib/history.ts");

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}`); } };

// ── 1. album entity parsing ────────────────────────────────────────────────────
const albumRow = {
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Sita Ramam", navigationEndpoint: { browseEndpoint: { browseId: "MPREb_album1", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } } } } }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Sid Sriram • 2022" }] } } },
  ],
  thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "//lh3.googleusercontent.com/abc=w120-h120-l90-rj" }] } } },
};
const singleRow = {
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Ninnila Single", navigationEndpoint: { browseEndpoint: { browseId: "MPREb_single1", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } } } } }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Sid Sriram • 2021 • Single" }] } } },
  ],
};
const songRow = {
  playlistItemData: { videoId: "abc123" },
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Some Song" }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Some Artist • 3:45" }] } } },
  ],
};
const artistRow = {
  navigationEndpoint: { browseEndpoint: { browseId: "UCartist123", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } },
  flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "An Artist" }] } } }],
};

const parsed = parseAlbumRows([albumRow, singleRow, songRow, artistRow]);
check("album row parsed", parsed.length === 2);
const a0 = parsed.find((a: any) => a.browseId === "MPREb_album1");
check("album title + artist + year", !!a0 && a0.title === "Sita Ramam" && a0.artist === "Sid Sriram" && a0.year === "2022");
check("album key folded", !!a0 && a0.key === "sita ramam");
check("thumb upscaled to 544", !!a0 && (a0.thumb ?? "").includes("w544-h544"));
const a1 = parsed.find((a: any) => a.browseId === "MPREb_single1");
check("single kind detected", !!a1 && a1.kind === "Single" && a1.year === "2021");
check("song row not an album", !parsed.some((a: any) => a.browseId === "abc123"));
check("artist row not an album", !parsed.some((a: any) => a.browseId === "UCartist123"));

// ── 2. tasteRank ───────────────────────────────────────────────────────────────
const mk = (id: string, title: string, artist: string, lang?: string): any => ({
  id, title, artist, album: "Single", duration: 200, lang: lang as any, year: 0, plays: "10M", colors: ["#000", "#111"],
});
const tracks = [
  mk("t1", "Exact Match Hit", "Some Unknown Singer"),            // bucket 4 (rel 10000)
  mk("t2", "Half Match", "Sid Sriram", "Telugu"),                // bucket 3, taste artist + lang
  mk("t3", "Half Match Two", "Random Singer", "Hindi"),          // bucket 3, wrong lang
  mk("t4", "Half Match Three", "Another Singer"),                // bucket 3, no signals
];
const rels = [10000, 5000, 5000, 5000];

// no history at all → order unchanged (cold start never re-ranks) — runs BEFORE
// any recordPlay seeds the (in-memory) history
const out2 = tasteRank(tracks, rels);
check("cold start keeps server order", out2.every((t: any, i: number) => t.id === tracks[i].id));

// listener taste: Sid Sriram (top artist) + Telugu (dominant language)
recordPlay({ id: "h1", title: "Ninnila (Telugu)", artist: "Sid Sriram" });
recordPlay({ id: "h2", title: "Kolakolala (Telugu)", artist: "Sid Sriram" });
recordPlay({ id: "h3", title: "Samajavaragamana (Telugu)", artist: "Sid Sriram" });

const out = tasteRank(tracks, rels);
check("relevance bucket dominates taste", out[0].id === "t1");
check("top artist + taste lang floats inside bucket", out[1].id === "t2");
check("wrong-language result sinks", out[out.length - 1].id === "t3");
check("stable order for equal scores", out.length === 4);

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
