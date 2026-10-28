/**
 * Language detection for live YouTube results — the glue behind the queue's
 * language chips (YTM's "Tamil / Telugu" autoplay filters).
 *
 * Two signals, in order of trust:
 *  1. Explicit markers in title/album — "(Telugu)", "[Hindi]", "From the Telugu movie …"
 *  2. Unicode script of title/album text — Telugu block → Telugu, Devanagari → Hindi, …
 *
 * Artist-name guessing stays forbidden (Anirudh composes across Tamil, Telugu and
 * Hindi — it mislabeled every collab), but script detection of SONG TEXT is safe:
 * native-script titles are unambiguous.
 */
import type { Lang } from "./types";
import { catalogNow } from "./catalog";

/** Unicode script ranges → language (only scripts our Lang union covers). */
const SCRIPTS: Array<{ re: RegExp; lang: Lang }> = [
  { re: /[\u0C00-\u0C7F]/, lang: "Telugu" },
  { re: /[\u0B80-\u0BFF]/, lang: "Tamil" },
  { re: /[\u0C80-\u0CFF]/, lang: "Kannada" },
  { re: /[\u0D00-\u0D7F]/, lang: "Malayalam" },
  { re: /[\u0A00-\u0A7F]/, lang: "Punjabi" },
  { re: /[\u0980-\u09FF]/, lang: "Bengali" },
  { re: /[\u0900-\u097F]/, lang: "Hindi" }, // Devanagari — after Gurmukhi/Bengali
];

const MARKER_RE =
  /\b(hindi|telugu|tamil|punjabi|kannada|malayalam|bengali|english)\b/i;

/** Language of one track's own text — explicit markers first, then native script. */
export function detectTrackLang(t: { title?: string; album?: string; lang?: Lang }): Lang | undefined {
  if (t.lang) return t.lang;
  const s = `${t.title ?? ""} ${t.album ?? ""}`;
  const m = s.match(MARKER_RE);
  if (m) {
    const word = m[1].toLowerCase();
    return (word.charAt(0).toUpperCase() + word.slice(1)) as Lang;
  }
  for (const { re, lang } of SCRIPTS) if (re.test(s)) return lang;
  return undefined;
}

// ── Catalog-backed inference for romanized live results ──────────────────────
// Live YouTube titles are usually romanized ("Vayasa Chusuko") — no explicit
// language marker, no native script, so detectTrackLang returns undefined and a
// Telugu seed's radio would drift across languages (the user-reported bug). Two
// signals from the live catalog close the gap (catalog.ts — real data only):
//   1. movie/album names are near-unique per industry — "Premante Idera" is Telugu,
//      "Aashiqui 2" is Hindi, no heuristics needed;
//   2. artist language profiles — an artist who appears in our catalog ONLY with
//      Hindi songs is very unlikely to be the Telugu song the mix suggests.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f]+/g, " ").trim();

let movieLangIdx: Map<string, Lang> | null = null;
let artistLangIdx: Map<string, Map<Lang, number>> | null = null;
let idxFromSize = -1; // catalog size the indexes were built from — rebuild when it changes

function ensureIndexes() {
  const catalog = catalogNow();
  const size = catalog?.length ?? 0;
  if (movieLangIdx && artistLangIdx && idxFromSize === size) return;
  movieLangIdx = new Map();
  artistLangIdx = new Map();
  idxFromSize = size;
  for (const t of catalog ?? []) {
    if (!t.lang) continue;
    for (const key of [t.movie, t.album]) {
      const k = key ? norm(key) : "";
      if (k && !movieLangIdx.has(k)) movieLangIdx.set(k, t.lang);
    }
    for (const a of t.artist.split(",")) {
      const k = norm(a);
      if (!k) continue;
      const m = artistLangIdx.get(k) ?? new Map<Lang, number>();
      m.set(t.lang, (m.get(t.lang) ?? 0) + 1);
      artistLangIdx.set(k, m);
    }
  }
}

function dominantOf(m: Map<Lang, number>): Lang {
  let best: Lang | undefined;
  let n = -1;
  for (const [l, c] of m) {
    if (c > n) {
      n = c;
      best = l;
    }
  }
  return best as Lang;
}

/**
 * Infer a language for a live (romanized) track using the live catalog. `seedLang`
 * biases the artist profile: an artist known to sing in the seed's language counts
 * as in-language; an artist who NEVER sings it is flagged as foreign (drift marker).
 */
export function inferLiveLang(
  t: { title: string; album?: string; artist: string },
  seedLang?: Lang,
): Lang | undefined {
  ensureIndexes();
  const alb = norm(t.album ?? "");
  if (alb && movieLangIdx!.has(alb)) return movieLangIdx!.get(alb);

  const profiles = t.artist
    .split(",")
    .map((a) => artistLangIdx!.get(norm(a)))
    .filter((m): m is Map<Lang, number> => !!m);
  if (profiles.length === 0) return undefined;
  if (!seedLang) return dominantOf(profiles[0]);
  const anySeed = profiles.some((m) => m.has(seedLang));
  if (anySeed) return seedLang; // in-language credit — matches YTM's language-stationary mixes
  return dominantOf(profiles[0]); // foreign-only artist → their language (drift marker for relateBlock)
}

/** The language a party/familiar query should lean on — current track first, then queue. */
export function firstLangOf(tracks: Array<{ title: string; album: string; lang?: Lang }>): Lang | undefined {
  for (const t of tracks) {
    const l = detectTrackLang(t);
    if (l) return l;
  }
  return undefined;
}

/**
 * Languages worth showing as queue chips — the dominant ones across the playing
 * queue (current + upcoming), capped like YTM (screenshot shows 2: Tamil, Telugu).
 * A language must appear at least twice OR be the current track's own language.
 */
export function queueLangs(
  tracks: Array<{ title: string; album: string; lang?: Lang }>,
  cap = 2,
): Lang[] {
  const counts = new Map<Lang, number>();
  for (const t of tracks) {
    const l = detectTrackLang(t);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const head = tracks.length > 0 ? detectTrackLang(tracks[0]) : undefined;
  return [...counts.entries()]
    .filter(([l, n]) => n >= 2 || l === head)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([l]) => l);
}
