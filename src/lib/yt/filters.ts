/**
 * Original-song filter — ported from the rules we validated in the earlier backend spike
 * (only original studio tracks; drop re-uploads, fan edits, shorts, jukeboxes, covers).
 */

export const RULES = {
  MIN_SEC: 60,
  MIN_SEC_OFFICIAL: 30,
  MAX_SEC: 1200,
  MIN_UGC_VIEWS: 100_000,
};

export const JUNK_PATTERNS: RegExp[] = [
  /\bslowed\b|\breverb\b|\bsped\s?up\b|\bnightcore\b|\bsynthwave\b|\b8d\b|\bbass\s?boosted\b/i,
  /\blofi\b|\blo-?fi\b|\bchill(?:ed)?\s?(?:hop|mix|beats)\b/i,
  /\bmashup\b|\bjukebox\b|\bnon[-\s]?stop\b|\bfull\s?album\b|\bfull\s?mixtape\b/i,
  /\b\d+\s?(?:hours?|hrs?|hr|minutes?|mins?)\b|\b1\s?hour\b/i,
  /\bwhatsapp\s?status\b|#shorts\b|\bshorts\s?feed\b/i,
  /\bfan\s?made\b|\bfanmade\b|\bcover\b|\bkaraoke\b|\btribute\b|\binstrumental\s?cover\b/i,
  /\bremix\b|\bremixes\b/i,
  // gendered re-recordings: "(Female)", "Male Version" — never the original studio track
  /\bfemale\b|\bmale\s?version\b|\bfemale\s?version\b/i,
  /\bANTHEM VERSION\b|\bvlog music\b/i,
  // podcasts & talk content — a song surface must never queue an interview
  /\bepisode\b|\bpodcast\b|\binterview\b|\breaction\b|\bbehind the scenes\b/i,
  // compilations & playlists-as-videos: real song titles never carry the plural "songs"
  // (long compilations additionally fall to the MAX_SEC duration rule). The trailing
  // words are "songs (plural)" in Tamil / Telugu / Hindi — same compilations, other scripts.
  /\bsongs\b|\bvideo jukebox\b|\bback to back\b|\btop\s?\d+\b|\bmovies?\s?list\b|\bfull movie\b|\bcompilation\b|பாடல்கள்|పాటలు|गीतों|हिट्स/i,
  // re-performed versions, never originals
  /\bunplugged\b|\blive\s?(?:at|in|from)\b|\bmedley\b/i,
  // "Full Video Song | Movie | Actor" upload noise — OMV titles that are all promo
  /\bvideo\s?song\b/i,
  // unicode-styled spam titles ("𝑻𝑹𝑬𝑵𝑫𝑰𝑵𝑮 𝑺𝑶𝑵𝑮𝑺", hieroglyph decorations) — real songs never
  /[\u{1D400}-\u{1D7FF}\u{13000}-\u{1342F}\u{1F130}-\u{1F16F}]/u,
];

export function parseViews(text: string): number {
  const m = text.match(/([\d.]+)\s*([KMB])\s*(?:views|plays)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1;
  return Math.round(n * mult);
}

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\(from[^)]*\)|\[from[^\]]*\]|\(official[^)]*\)|\[official[^\]]*\]|\(video[^)]*\)|\(lyrics?[^)]*\)|\(audio[^)]*\)/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/official\s?(?:music\s?)?(?:video|audio|lyric[s]?)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isJunkTitle(title: string): boolean {
  return JUNK_PATTERNS.some((r) => r.test(title));
}

export type ItemKind = "song" | "video" | "other";

export interface SearchTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  views: number;
  kind: ItemKind;
  /** largest square thumbnail URL (real album art) when the result carries one */
  thumb?: string;
  /** tier 1 = ATV official song, 2 = OFFICIAL_SOURCE, 3 = clean UGC, 0 = rejected */
  tier: number;
  dropReason?: string;
}

/** Classify one parsed search item. Returns tier 0 with dropReason when rejected. */
export function classify(t: Omit<SearchTrack, "tier" | "dropReason">): SearchTrack {
  if (t.kind === "other") return { ...t, tier: 0, dropReason: "not-a-track" };
  // Artist slot is junk-checked too: podcast episodes arrive as
  // title="<episode name>", artist="Episode" — the title alone looks clean.
  if (isJunkTitle(t.title) || (t.artist && !t.artist.includes(",") && isJunkTitle(t.artist))) {
    return { ...t, tier: 0, dropReason: "junk-title" };
  }
  const min = t.kind === "song" ? RULES.MIN_SEC_OFFICIAL : RULES.MIN_SEC;
  if (t.durationSec > 0 && t.durationSec < min) return { ...t, tier: 0, dropReason: "too-short" };
  if (t.durationSec > RULES.MAX_SEC) return { ...t, tier: 0, dropReason: "too-long" };
  if (t.kind === "song") return { ...t, tier: 1 };
  // video kind: official if from official source or high-view UGC
  if (t.views >= RULES.MIN_UGC_VIEWS) return { ...t, tier: 2 };
  return { ...t, tier: 3 };
}

/**
 * Relevance scoring — query match MUST dominate raw popularity.
 *
 * Why: sanitize() intentionally orders by tier→views, which is right for radio pools
 * (popularity-first) but catastrophic for search UX: a query for an exact — but obscure —
 * title ("nizam babulu") sank to #8 behind more-viewed era-mates. YT's own order isn't
 * trusted either (datacenter IP + gl=IN skews it). So search.ts re-ranks with this scorer:
 *   exact title ≫ prefix ≫ phrase-in-title ≫ token overlap ≫ artist ≫ album ≫ views.
 * Views only contribute a tiny tail (~max 30) so it can never outrank a real match.
 */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Bounded edit distance — true when a and b differ by at most 1 insertion/deletion/substitution. */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (s.length === l.length) { i++; j++; } else { j++; } // substitution vs insertion
  }
  return true; // trailing char mismatch is at most one edit by construction
}

export function relevanceScore(
  t: { title: string; artist: string; album?: string; views?: number },
  query: string
): number {
  const nq = fold(query).replace(/\s+/g, " ").trim();
  if (!nq) return 0;
  const nt = fold(normalizeTitle(t.title));
  const na = fold(t.artist);
  const nab = fold(t.album ?? "");

  let score = 0;

  // ── Title phrase tiers — STRONG directions only for multi-token queries ──
  // exact ≫ title extends typed query ≫ typed phrase inside title.
  // The weak directions (title is a prefix/fragment of a LONGER query) were removed:
  // for "sankranthi doli doli" they crowned every unrelated "Sankranthi"-titled song
  // over the actual "Doli Doli", and for "butta bomma" pushed 0-view junk "Butta" to #1.
  // Kept only for single-token queries where the title is a prefix of the typed word.
  if (nt === nq) score += 10000;
  else if (nt.startsWith(nq)) score += 7000;
  else if (nt.includes(nq)) score += 5000;
  else if (!nq.includes(" ") && nt.length >= 4 && (nq.startsWith(nt) || nq.includes(` ${nt}`))) score += 2200;

  // ── Token overlap across title + artist + album (word-boundary aware, deduped) ──
  const qToks = [...new Set(nq.split(" ").filter((w) => w.length > 1))];
  if (qToks.length > 0) {
    const tToks = nt.split(" ");
    const aToks = na.split(/[,/&]+/).flatMap((a) => a.trim().split(" ")).filter(Boolean);
    const abToks = nab.split(" ");
    let matched = 0;
    let titleHit = 0;
    for (const q of qToks) {
      if (tToks.some((w) => w === q)) { matched += 3; titleHit++; continue; } // whole word in title
      if (tToks.some((w) => w.length > 1 && (w.startsWith(q) || (q.length > 2 && q.startsWith(w))))) { matched += 2; titleHit++; continue; } // title prefix
      if (nt.includes(q)) { matched += 1; titleHit++; continue; } // substring in title
      if (aToks.some((w) => w === q) || (q.length >= 5 && aToks.some((w) => w.length >= 5 && withinOne(w, q)))) { matched += 2; continue; } // artist exact / typo (d≤1)
      if (aToks.some((w) => w.length > 1 && (w.startsWith(q) || (q.length > 2 && q.startsWith(w))))) { matched += 1; continue; } // artist prefix
      if (abToks.some((w) => w === q)) { matched += 3; continue; } // whole word in album (movie/album entity — "sankranthi doli doli" needs this to tie with title-junk so tier can decide)
      if (nab.includes(q)) matched += 1; // substring in album
    }
    const max = qToks.length * 3;
    // If the TITLE contains none of the query, this is at best an album-mate (OST BGM
    // tracks, compilation neighbors) — cap its token score so it can't outrank real
    // title matches ("rowdy baby" → "Anu's Mom Takes Her Back Home…" must stay low).
    const tokenScore = (matched / max) * 2000;
    score += titleHit === 0 && matched > 0 ? Math.min(tokenScore, 1000) : tokenScore;
  }

  // ── Artist / album secondary signals ──
  if (na && (na === nq || na.startsWith(nq) || na.includes(nq))) score += 600;
  else if (qToks.length > 1 && qToks.every((w) => na.includes(w))) score += 400;
  if (nab && nab.includes(nq)) score += 150;

  // ── Popularity tail (tiebreaker only — can never beat a real match) ──
  if (t.views && t.views > 0) score += Math.min(30, Math.log10(t.views + 1) * 2.5);

  return score;
}

/** Relevance-first ranking: query match dominates; tier & views only break ties. */
export function relevanceRank<T extends { title: string; artist: string; album?: string; views?: number; tier: number }>(
  tracks: T[],
  query: string
): T[] {
  const scored = tracks.map((t, i) => ({ t, s: relevanceScore(t, query), i }));
  scored.sort((a, b) => b.s - a.s || a.t.tier - b.t.tier || (b.t.views ?? 0) - (a.t.views ?? 0) || a.i - b.i);
  return scored.map((x) => x.t);
}

/**
 * Dedupe + reupload protection: when an official version exists for a normalized title,
 * drop lower-tier duplicates (ugc-fallback-dropped), keep the best tier per title+artist.
 */
export function sanitize(tracks: SearchTrack[]): { clean: SearchTrack[]; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {};
  const bump = (k: string) => (dropped[k] = (dropped[k] ?? 0) + 1);

  const seen = new Map<string, SearchTrack>();
  const officialTitles = new Set<string>();
  for (const t of tracks) {
    if (t.tier > 0 && t.tier <= 2) officialTitles.add(normalizeTitle(`${t.title}|${t.artist.split(",")[0]}`));
  }

  for (const t of tracks) {
    if (t.tier === 0) {
      bump(t.dropReason ?? "unknown");
      continue;
    }
    const key = normalizeTitle(`${t.title}|${t.artist.split(",")[0]}`);
    const prev = seen.get(key);
    if (prev) {
      // same key: prefer better tier, then more views
      if (t.tier < prev.tier || (t.tier === prev.tier && t.views > prev.views)) seen.set(key, t);
      bump("dup");
      continue;
    }
    seen.set(key, t);
  }

  const clean: SearchTrack[] = [];
  for (const t of seen.values()) {
    if (t.tier >= 3) {
      const offKey = normalizeTitle(`${t.title}|${t.artist.split(",")[0]}`);
      if (officialTitles.has(offKey)) {
        bump("ugc-fallback-dropped");
        continue;
      }
    }
    clean.push(t);
  }
  return { clean: clean.sort((a, b) => a.tier - b.tier || b.views - a.views), dropped };
}
