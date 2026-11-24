/**
 * Language detection for live YouTube results — the glue behind the queue's
 * language chips (YTM's "Tamil / Telugu" autoplay filters) AND the strict feed
 * filter (trackLangOf).
 *
 * Signals, in order of trust:
 *  1. Explicit markers in title/album — "(Telugu)", "[Hindi]", "From the Telugu movie …"
 *  2. Unicode script of title/album text — Telugu block → Telugu, Devanagari → Hindi, …
 *  3. Movie/album names from the live catalog — near-unique per industry (data, no guessing)
 *  4. Romanized song-title WORDS — "Kesariya"/"pyaar" are Hindi, "bomma"/"manasu" are
 *     Telugu, "kadhal"/"thozha" are Tamil (see the classifier below)
 *  5. Artist catalog profiles — only when the artist sings exactly ONE catalog language
 *     (or dominates by a 4× margin); multilingual artists (Sid Sriram sings Telugu,
 *     Tamil, Hindi…) prove nothing about a single song
 *
 * Artist-name guessing stays forbidden as the FIRST signal (Anirudh composes across
 * Tamil, Telugu and Hindi — it mislabeled every collab), but script detection of
 * SONG TEXT is safe: native-script titles are unambiguous.
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

// ── Romanized-title WORD classifier (per-song evidence for the strict feed) ──
// YouTube titles are usually romanized ("Kesariya", "Butta Bomma") — no marker,
// no native script. Artist profiles can't separate a multilingual artist's
// songs (Sid Sriram sings Telugu, Tamil AND Hindi), but song TITLE words can:
// Hindi/Urdu romanization and the Dravidian languages have near-disjoint
// vocabularies. High-precision lists ONLY — a false Hindi label drops a real
// Telugu song (shelf thins), a false Telugu label leaks a Hindi song into the
// feed (the exact bug the user reported). Words that appear in 2+ languages'
// songs live in AMBIGUOUS and are never evidence.
const WORDS: Partial<Record<Lang, string[]>> = {
  Hindi: [
    "dil", "dilbar", "pyaar", "pyar", "ishq", "mohabbat", "sanam", "jaan", "janam",
    "dard", "khuda", "rab", "yaad", "zindagi", "tere", "tera", "teri", "mera", "meri",
    "mere", "apna", "apni", "aashiq", "aashiqui", "saathiya", "sajna", "ranjha",
    "heeriye", "kesariya", "sawan", "barsaat", "aankhein", "naino", "chand", "chanda",
    "sitara", "badal", "phir", "kyun", "hain", "tum", "hum", "yaar", "zaalima",
    "bewafa", "wafa", "adhoora", "adhoori", "duniya", "manzil", "banjaara", "khoya",
    "kaise", "kaisa", "kaisi", "kitna", "kitni", "jab", "naam", "humdum", "bewajah",
    // note: "tere/tera/teri" are shared with Punjabi romanization — tolerated,
    // Hindi and Punjabi both sit on the same side of the Dravidian barrier
  ],
  Telugu: [
    "nuvvu", "nenu", "kannulu", "cheliya", "chelli", "bomma", "bujji",
    "ammai", "abbayi", "hrudayam", "kalalu", "raave", "raava", "kaavaale", "vayasa",
    "samudram", "priyathama", "priyatama", "oohalu", "maate", "vennela", "vennello",
    "devuda", "telusu", "telusa", "telupu", "andham", "andhaala", "mogudu",
    "gundello", "antava", "vachinde", "pilla", "chinuku", "navvu", "kadile",
  ],
  Tamil: [
    "naan", "kadhal", "kadhale", "kannamma", "vaanam", "unnai", "enna", "ennavo",
    "uyire", "uyir", "kanave", "kanaa", "vizhi", "mazhai", "megham", "thamizh",
    "tamizh", "penn", "paarvai", "solla", "solli", "vendum", "naanum", "thozha",
    "thozhi", "anbe", "anbu", "vaathi", "pillai", "kanmani", "chellame",
  ],
  Punjabi: [
    "kudi", "kude", "raataan", "raatan", "chann", "jatt", "jatti", "suit",
    "patiala", "mainu", "tenu", "sadda", "munda", "gabru", "chitti", "punjabi",
  ],
  Kannada: [
    "neenu", "kanasu", "nagu", "nagutha", "naguthe", "yeno", "yaako",
    "hennu", "baaro",
  ],
  Malayalam: [
    "njan", "njaan", "snehame", "mizhi", "mizhikal", "thooval", "priye",
    "venmegham", "nin",
  ],
  Bengali: [
    "tumi", "tomar", "bhalo", "bhalobashi", "bhalobasha", "keno", "mon", "hashi",
    "chokh", "dukho", "amar",
  ],
};

/** Words shared across languages' romanized songs — never evidence. */
const AMBIGUOUS = new Set([
  "nee", "naa", "kanne", "chinni", "chinna", "rendu", "mahi", "mahive", "ponnu",
  "kannil", "manasu", "prema", "premalo", "pranaya", "naanu", "kanu", "raja",
  "kallu",
]);

/**
 * Language guessed from ROMANIZED song-title words only. Requires the winner to
 * beat every other language (a tie — one Hindi word + one Telugu word — proves
 * nothing and answers undefined). English is deliberately absent: Latin-script
 * songs with no Indian word hits fall through to the rest of the ladder, and a
 * strict feed then drops them (exactly right for an Indian-language listener).
 */
export function guessLangFromWords(text: string): Lang | undefined {
  const s = (text ?? "").toLowerCase();
  if (!/[a-z]/.test(s)) return undefined;
  const tokens = new Set(s.split(/[^a-z]+/).filter((w) => w.length >= 3 && !AMBIGUOUS.has(w)));
  if (tokens.size === 0) return undefined;
  let best: Lang | undefined;
  let bestHits = 0;
  let tie = false;
  for (const [lang, list] of Object.entries(WORDS) as Array<[Lang, string[]]>) {
    let hits = 0;
    for (const w of list) if (tokens.has(w)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = lang;
      tie = false;
    } else if (hits > 0 && hits === bestHits) {
      tie = true;
    }
  }
  return tie ? undefined : bestHits > 0 ? best : undefined;
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
 * `opts.noArtist` skips the artist-profile leg entirely — used by api.ts when
 * stamping the Track.lang FIELD: a multilingual artist's dominant language is a
 * prior about the ARTIST, not evidence about THIS song (Sid Sriram's dominant
 * Telugu must never brand his Hindi songs "Telugu"). The strict feed ladder
 * (trackLangOf) applies the artist leg only as the last resort.
 */
export function inferLiveLang(
  t: { title: string; album?: string; artist: string },
  seedLang?: Lang,
  opts: { noArtist?: boolean } = {},
): Lang | undefined {
  ensureIndexes();
  const alb = norm(t.album ?? "");
  if (alb && movieLangIdx!.has(alb)) return movieLangIdx!.get(alb);
  if (opts.noArtist) return undefined;

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

// ── The STRICT ladder (trackLangOf) — per-song language, no leakage ──────────
// The feed's strict filter needs the best per-song answer, in evidence order:
// explicit field → marker → native script → movie/album fact → title words →
// artist profile ONLY when it is decisive (exactly one catalog language, or a
// 4× dominant margin with ≥4 catalog songs). Undefined = genuinely unknown —
// the strict filter then decides (drop, unless the pool's own source language
// may be presumed).
export function trackLangOf(
  t: { title?: string; album?: string; artist?: string; lang?: Lang },
): Lang | undefined {
  if (t.lang) return t.lang; // frozen at play time / catalog anchoring — a fact
  const direct = detectTrackLang({ title: t.title, album: t.album });
  if (direct) return direct;

  ensureIndexes();
  const alb = norm(t.album ?? "");
  if (alb && movieLangIdx!.has(alb)) return movieLangIdx!.get(alb);

  const words = guessLangFromWords(`${t.title ?? ""} ${t.album ?? ""}`);
  if (words) return words;

  const profiles = (t.artist ?? "")
    .split(",")
    .map((a) => artistLangIdx!.get(norm(a)))
    .filter((m): m is Map<Lang, number> => !!m);
  const first = profiles[0];
  if (first) {
    if (first.size === 1) return [...first.keys()][0]; // artist sings ONE language
    const sorted = [...first.entries()].sort((a, b) => b[1] - a[1]);
    const [l1, c1] = sorted[0];
    const c2 = sorted[1]?.[1] ?? 0;
    if (c1 >= 4 && c1 >= 4 * c2) return l1; // decisive dominance only
  }
  return undefined;
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
