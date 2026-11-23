/**
 * Radio-block builder — the VIBE + LANGUAGE rules of the queue, as pure
 * functions (no React, no player state) so they're unit-testable.
 *
 * Two laws the user set for every queue:
 *
 * 1. LANGUAGE BARRIER — hard. A radio block lives ENTIRELY in the played
 *    song's language (or the language chip the user explicitly tapped).
 *    Tracks detected in any other language are DROPPED, never kept as
 *    filler "when the pool is thin" — the old drift-as-filler rule is gone.
 *    The same song in another language ("Massa Massa (Hindi)" behind a
 *    "(Telugu)" seed) is drift, not variety, and is dropped too.
 *    Tracks whose language can't be detected stay: detection is best-effort
 *    (romanized titles carry no markers), and the Mix pool is seeded by the
 *    song itself, so undetectable rows are overwhelmingly in-language.
 *    extendRadio tops thin blocks up with same-language searches instead.
 *
 * 2. VIBE MATCH — the block leads with the seed's own world: songs from the
 *    same movie/album (same soundtrack = same vibe), then the seed's
 *    artist/composer, then the related Mix. The listener's taste
 *    (familiarBoost — their most-played artists) reorders the front after
 *    the artist-spaced shuffle in the player.
 */

import type { Lang, Track } from "./types";

/** "(Telugu)", "(From "Aashiqui 2")", "– Hindi", version suffixes — noise hiding that two titles are the same song. */
export const TITLE_NOISE_RE =
  /\s*\((?:from[^)]*|\b\d{4}\b|telugu|hindi|tamil|kannada|malayalam|punjabi|bengali|english|version|reprised?|unplugged|acoustic|lo-?fi)\)\s*|\s[-–]\s*(?:telugu|hindi|tamil|kannada|malayalam)\s*$/gi;

/** "Massa Massa (Hindi)" and "Massa Massa (Telugu)" collapse to the same base song. */
export function baseTitle(title: string): string {
  return title.replace(TITLE_NOISE_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Lead an autoplay block with the seed song's own artist/composer (up to 5), so the
 * "similar vibe / related artist" promise is literally visible in the first rows —
 * YTM mixes do the same: the seed's artist dominates the top of the block.
 */
export function promoteSeedArtist(seed: Track, pool: Track[]): Track[] {
  const keys = new Set(seed.artist.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
  if (keys.size === 0) return pool;
  const same: Track[] = [];
  const rest: Track[] = [];
  for (const t of pool) {
    const match = t.artist.split(",").some((a) => keys.has(a.trim().toLowerCase()));
    if (match && same.length < 5) same.push(t);
    else rest.push(t);
  }
  return [...same, ...rest];
}

/** The movie/album identity of a track (live results carry it in `album`). */
function albumOf(t: Track): string {
  return (t.movie || t.album || "").trim().toLowerCase();
}

/**
 * Language-detect + vibe-order a raw radio pool into one block.
 *
 * `forcedLang` is the user's EXPLICIT language chip (lang:<X>) — when set it
 * overrides the seed's own language (the user asked for that queue, so it is
 * not drift). Without it the block locks to the played song's language.
 */
export function relateBlock(
  seed: Track,
  pool: Track[],
  langOf: (t: Track) => Lang | undefined,
  forcedLang?: Lang
): Track[] {
  const lang = forcedLang ?? langOf(seed);
  if (!lang) return promoteSeedArtist(seed, pool);
  const seedBase = baseTitle(seed.title);
  const isVariant = (t: Track) => baseTitle(t.title) === seedBase;

  // the barrier: only in-language + undetectable survive; everything else is dropped
  const keep = pool.filter((t) => {
    const l = langOf(t);
    if (l !== undefined && l !== lang) return false; // another language — dropped, hard
    return !isVariant(t); // same song in another language — drift, dropped
  });

  // vibe order: the seed's own movie/album mates first (same soundtrack), then
  // the seed's artist/composer lead, then the rest of the in-language pool
  const seedAlbum = albumOf(seed);
  const mates: Track[] = [];
  const rest: Track[] = [];
  for (const t of keep) {
    const isMate = seedAlbum.length >= 3 && albumOf(t) === seedAlbum;
    if (isMate && mates.length < 4) mates.push(t);
    else rest.push(t);
  }
  return [...mates, ...promoteSeedArtist(seed, rest)];
}

/**
 * Artist cap per radio block — the anti-"queue full of one artist" rule (the
 * user-facing bug: play one Sushin Shyam song, get ONLY Sushin Shyam back).
 * A regular artist contributes at most 2 songs per block; the seed song's own
 * artist/composer keeps 3 so the "similar vibe" promise stays visible up top.
 */
export function capArtists(pool: Track[], seedArtist: string): Track[] {
  const ARTIST_CAP = 2;
  const SEED_CAP = 3;
  const seedKeys = new Set(seedArtist.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
  const counts = new Map<string, number>();
  const out: Track[] = [];
  for (const t of pool) {
    const parts = t.artist.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
    const key = parts[0] || t.artist.toLowerCase();
    const isSeed = parts.some((a) => seedKeys.has(a));
    const cap = isSeed ? SEED_CAP : ARTIST_CAP;
    const n = counts.get(key) ?? 0;
    if (n >= cap) continue;
    counts.set(key, n + 1);
    out.push(t);
  }
  return out;
}
