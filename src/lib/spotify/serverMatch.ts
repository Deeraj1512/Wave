/**
 * SERVER ONLY — the Spotify track → YouTube videoId matcher. The actual
 * product work of the Spotify layer: a Spotify track is metadata only, Wave
 * plays YouTube audio (Echo chain / YT IFrame engine), so every Spotify track
 * must land on a videoId before the app can do anything with it.
 *
 * Matching pipeline per track:
 *   1. YTM search "title artist" through searchOriginals — the SAME
 *      originals-only chain the app's own search uses, so covers / lofi /
 *      nightcore / mashups are already filtered at the source.
 *   2. Empty → retry with the bare title (movie-compilation uploads).
 *   3. Score every candidate: duration window (±2s ideal, >16s rejected),
 *      title similarity (Dice over folded word tokens, YTM upload noise
 *      cleaned first), primary-artist similarity (containment handles
 *      "… - Topic" channels), originals tier bonus, query-relevance bonus.
 *   4. Best candidate ≥ 48 wins; below that the track ships UNMATCHED (the
 *      UI renders it dimmed) — a wrong videoId is worse than no videoId.
 *
 * Caches: spotifyId → match lives for the whole function-instance lifetime
 * (Spotify ids are immutable), YTM query results 10 minutes, in-flight
 * dedup for both — an album page never hammers YTM with duplicate queries.
 */

import { searchOriginals } from "@/lib/yt/search";

export interface SpMatchInput {
  id: string;
  name: string;
  durationMs: number;
  artists: string[];
}

interface YtHit {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  views: number;
  tier: number;
  thumb?: string;
  rel?: number;
}

export interface MatchResult {
  videoId: string | null;
  confidence: number;
}

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * YTM upload-title noise → the song name (mirrors the client's displayTitle,
 * but for MATCHING, so the raw title is preserved in what we hand back).
 */
function cleanTitle(raw: string): string {
  let s = raw
    .replace(/\s*\(From[^)]*\)/i, " ")
    .replace(/\s*\[From[^)]*\]/i, " ")
    .replace(/\s*\("[^"]*"\)\s*$/, " ") // Spotify's ("Album Name") tail
    .trim();
  if (s.includes("|")) s = s.split("|")[0].trim();
  s = s
    .replace(
      /\b(video\s?song|full\s?song|full\s?video|lyrical\s?video|lyrical|official\s?(?:video|audio|song|lyrics)|audio\s?song|4k|8k|hd|remastered|audio\s?jukebox|jukebox)\b/gi,
      " "
    )
    .replace(/\s*\((?:tamil|telugu|hindi|malayalam|kannada|punjabi|bengali|marathi)\)\s*/gi, " ");
  return s.replace(/\s{2,}/g, " ").trim();
}

const tokens = (s: string): Set<string> =>
  new Set(
    fold(s)
      .split(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff\u0c00-\u0c7f]+/)
      .filter(Boolean)
  );

/** Dice coefficient over word tokens — containment-friendly similarity. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function sim(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  // Containment ("Arman Malik" vs "Arman Malik - Topic", "X (Official Audio)")
  // — but ONLY when the extra material is a token or two. A podcast titled
  // "Interview: How We Wrote Naatu Naatu" also contains the song name; without
  // the guard it would ride the 0.92 shortcut straight past the bar.
  const [shorter, longer] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (longer.includes(shorter)) {
    const extra = tokens(longer).size - tokens(shorter).size;
    if (extra <= 1) return 0.92;
  }
  return dice(tokens(a), tokens(b));
}

/**
 * Score one candidate. null = hard reject (wrong duration beyond rescue or a
 * title that isn't the song at all). Otherwise 0..100+; ≥ 48 accepts.
 * Exported for offline threshold tests (scripts/test_spotify_match.ts).
 */
export function scoreHit(sp: SpMatchInput, hit: YtHit): number | null {
  const dur = Math.round(sp.durationMs / 1000);
  const d = Math.abs(hit.durationSec - dur);
  let durScore: number;
  if (d <= 2) durScore = 30;
  else if (d <= 5) durScore = 20;
  else if (d <= 10) durScore = 10;
  else if (d <= 16) durScore = 0;
  else return null;

  // both sides cleaned — Spotify and YTM decorate titles equally
  const tSim = sim(cleanTitle(sp.name), cleanTitle(hit.title));
  if (tSim < 0.3) return null;
  const titleScore = tSim >= 0.95 ? 32 : tSim >= 0.7 ? 24 : 14;

  // "Anirudh Ravichander" vs "Anirudh Ravichander - Topic" — containment wins.
  const firstArtist = sp.artists[0] ? fold(sp.artists[0]) : "";
  const aSim = firstArtist ? sim(firstArtist, hit.artist) : 0;
  const artistScore = aSim >= 0.9 ? 16 : aSim >= 0.55 ? 9 : 0;

  // searchOriginals tiers: 1 = YTM-provided original (ATV / official audio), 2 = clean original upload
  const tierScore = hit.tier === 1 ? 8 : hit.tier === 2 ? 3 : 0;
  const relScore = Math.min(8, (hit.rel ?? 0) / 800);

  return durScore + titleScore + artistScore + tierScore + relScore;
}

const QUERY_TTL = 10 * 60 * 1000;
const queryCache = new Map<string, { at: number; hits: YtHit[] }>();
const inflightQ = new Map<string, Promise<YtHit[]>>();
const videoCache = new Map<string, MatchResult>();
const inflightV = new Map<string, Promise<MatchResult>>();

async function ytSearch(q: string): Promise<YtHit[]> {
  const key = q.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL) return hit.hits;
  const p = inflightQ.get(key);
  if (p) return p;
  const job = (async () => {
    const res = await searchOriginals(q);
    const hits: YtHit[] = res.tracks.map((t) => ({
      videoId: t.videoId,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationSec: t.durationSec,
      views: t.views,
      tier: t.tier,
      thumb: t.thumb,
      rel: t.rel,
    }));
    queryCache.set(key, { at: Date.now(), hits });
    return hits;
  })().finally(() => {
    inflightQ.delete(key);
  });
  inflightQ.set(key, job);
  return job;
}

export async function matchSpotifyTrack(sp: SpMatchInput): Promise<MatchResult> {
  const cached = videoCache.get(sp.id);
  if (cached) return cached;
  const p = inflightV.get(sp.id);
  if (p) return p;
  const job = (async (): Promise<MatchResult> => {
    const artistFirst = (sp.artists[0] ?? "").trim();
    let hits: YtHit[] = [];
    try {
      hits = await ytSearch(`${sp.name} ${artistFirst}`.trim());
    } catch {
      /* fall through to the retry */
    }
    if (hits.length === 0) {
      try {
        hits = await ytSearch(sp.name);
      } catch {
        /* unmatched below */
      }
    }
    let best: MatchResult = { videoId: null, confidence: 0 };
    let bestScore = 0;
    for (const h of hits) {
      const s = scoreHit(sp, h);
      if (s === null || s <= bestScore) continue;
      bestScore = s;
      best = { videoId: h.videoId, confidence: Math.min(1, s / 100) };
    }
    if (bestScore < 48) best = { videoId: null, confidence: 0 };
    videoCache.set(sp.id, best);
    return best;
  })().finally(() => {
    inflightV.delete(sp.id);
  });
  inflightV.set(sp.id, job);
  return job;
}

/** Match a batch with bounded concurrency, preserving input order. */
export async function matchSpotifyBatch(
  items: SpMatchInput[],
  concurrency = 6
): Promise<MatchResult[]> {
  const out: MatchResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      try {
        out[idx] = await matchSpotifyTrack(items[idx]);
      } catch {
        out[idx] = { videoId: null, confidence: 0 };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
