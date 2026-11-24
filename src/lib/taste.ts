/**
 * Taste engine — Batch 2's ranking rules, as pure functions (unit-testable).
 *
 * The user's standing law, in his own words: songs the user actually listens
 * to must be PRIORITIZED; a language he never listens to must never float
 * above his music — English at the top "should not happen".
 *
 * Three rules every surface obeys:
 *
 * 1. TASTE LANGUAGES (rankedTasteLangs) — onboarding picks, in pick order,
 *    merged with real listening weights from history. The profile speaks even
 *    with zero history (fresh install), history sharpens it afterwards.
 *
 * 2. PROGRESSIVE LANGUAGE RULE (progressiveMix) — songs OUTSIDE the taste
 *    languages are allowed to trickle in ONE or TWO at a time, evenly spread
 *    through the list, never as a block, never more than the cap. "In the
 *    feed there can be other language songs but 1-2 songs only at a time."
 *    A 18-tile Quick picks grid admits at most 2; a 12-row shelf admits 1;
 *    a long radio admits a proportional few. Undetected-language songs are
 *    treated as in-taste (detection is best-effort; Mix pools are seeded by
 *    the user's own plays).
 *
 * 3. TASTE ORDER (tasteOrder) — inside the allowed set: taste-language songs
 *    first (ranked by taste rank), then familiar artists promoted, then
 *    everything else; most-played wins ties.
 */

import type { Lang, Track } from "./types";
import { detectTrackLang } from "./langs";
import { profileArtists, rankedTasteLangs } from "./profile";
import { topArtists } from "./history";

// ── rule 1: the ranked taste language list ──────────────────────────────────

/**
 * Listening weight per language from play history (already computed by
 * callers in some paths — pass it in to avoid recompute). Each profile pick
 * also carries a floor weight in PICK ORDER, so a fresh install still ranks
 * Telugu-over-Hindi exactly the way the user tapped them.
 */
export function tasteLangWeights(historyWeights?: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const picks = rankedTasteLangs();
  // pick-order floor: #1 gets 5, each later pick 1 less (min 1)
  picks.forEach((l, i) => out.set(l, Math.max(1, 5 - i)));
  if (historyWeights) {
    for (const [l, w] of historyWeights) {
      out.set(l, (out.get(l) ?? 0) + w);
    }
  }
  return out;
}

// ── rule 2: the progressive language rule ───────────────────────────────────

/** Language of a track — explicit field, markers, native script. */
function langOf(t: { title: string; album?: string; lang?: Lang }): Lang | undefined {
  return t.lang ?? detectTrackLang({ title: t.title, album: t.album });
}

/** Is this track inside the listener's taste languages? */
export function inTaste(
  t: { title: string; album?: string; lang?: Lang },
  taste: Lang[]
): boolean {
  const l = langOf(t);
  if (l === undefined) return true; // undetectable — treated as in-taste (never punished)
  return taste.includes(l);
}

/**
 * Split a pool into taste-body + foreign-trickle, then interleave the trickle
 * evenly. `cap` = hard ceiling on foreign songs (undefined = proportional:
 * ~1 per 8 body tracks, min 1, max 4 — the "1-2 songs at a time" rule).
 * Order within each group is preserved (callers shuffle upstream).
 */
export function progressiveMix<T extends { title: string; album?: string; lang?: Lang }>(
  pool: T[],
  taste: Lang[],
  opts: { cap?: number; rnd?: () => number } = {}
): T[] {
  if (taste.length === 0) return pool; // no taste signal → the pool speaks for itself
  const body: T[] = [];
  const foreign: T[] = [];
  for (const t of pool) (inTaste(t, taste) ? body : foreign).push(t);
  if (body.length === 0) {
    // pool is ALL foreign — allow the proportional few (never zero out the shelf)
    const cap = opts.cap ?? 2;
    return foreign.slice(0, cap);
  }
  const cap = opts.cap ?? Math.min(4, Math.max(1, Math.round(body.length / 8)));
  const n = Math.min(foreign.length, cap);
  if (n === 0) return body;

  // even spread: place one foreign track after every ceil(body/n) body tracks,
  // with an optional seeded jitter so refreshes don't repeat the same slots
  const out: T[] = [];
  const stride = body.length / n;
  let fi = 0;
  for (let b = 0; b < body.length; b++) {
    out.push(body[b]);
    const nextSlot = Math.round((fi + 1) * stride);
    if (fi < n && b + 1 >= Math.floor(nextSlot) && b + 1 < body.length) {
      out.push(foreign[fi++]);
    }
  }
  while (fi < n) out.push(foreign[fi++]); // safety (stride rounding can strand the tail)
  return out;
}

// ── rule 3: taste order for shelves ─────────────────────────────────────────

/**
 * Stable taste sort: taste-language tracks first (earlier taste rank wins),
 * familiar artists pulled forward inside their lane, most-played as tiebreak.
 * Used by shelves that receive an unranked pool (discovery, catalog slices).
 */
export function tasteOrder<T extends { title: string; album?: string; artist: string; plays?: string; lang?: Lang }>(
  tracks: T[],
  taste: Lang[]
): T[] {
  const langRank = new Map(taste.map((l, i) => [l, i]));
  const fam = familiarSet();
  const playsNum = (p?: string) => {
    const m = /^([\d.]+)\s*([KMB]?)$/i.exec((p ?? "").trim());
    if (!m) return 0;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ""] ?? 1;
    return Math.round(parseFloat(m[1]) * mult);
  };
  const score = (t: T): number[] => {
    const l = langOf(t);
    const lr = l !== undefined ? (langRank.has(l) ? langRank.get(l)! : (l === "English" ? 90 : 80)) : 20; // unknown ≈ neutral
    const famHit = fam.has(t.artist.split(",")[0].trim().toLowerCase()) ? 0 : 1;
    return [lr, famHit, -playsNum(t.plays)];
  };
  return [...tracks].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return 0;
  });
}

/** Familiar artists = onboarding picks ∪ history top artists (lowercased). */
export function familiarSet(): Set<string> {
  const s = new Set<string>();
  try {
    for (const a of profileArtists()) s.add(a.split(",")[0].trim().toLowerCase());
    for (const a of topArtists(10)) s.add(a.trim().toLowerCase());
  } catch {
    /* no profile / no history yet */
  }
  return s;
}

// ── rule 4: the personal feed — "Made for you" from the picked artists ──────

/**
 * Round-robin interleave across artist groups: one song from group 0, one from
 * group 1, … and wrap. Group ORDER is preserved — callers pass groups in
 * language pick order, so the shelf breathes Telugu → Hindi → Telugu exactly
 * the way the user ranked their languages, and no single artist hogs it.
 * Inside each group the caller pre-shuffles (seeded), so every refresh brings
 * different songs from the same favorite artists.
 */
export function roundRobin<T>(groups: T[][], opts: { take?: number } = {}): T[] {
  const take = opts.take ?? Infinity;
  const out: T[] = [];
  const idx = groups.map(() => 0);
  let added = true;
  while (added && out.length < take) {
    added = false;
    for (let g = 0; g < groups.length && out.length < take; g++) {
      const i = idx[g];
      if (i < groups[g].length) {
        out.push(groups[g][i]);
        idx[g] = i + 1;
        added = true;
      }
    }
  }
  return out;
}

/**
 * Ongoing taste: weave familiar-artist songs (profile picks ∪ most-played)
 * through a shuffled pool — two familiar for every one unfamiliar — so Quick
 * picks always lead with the artists the user actually chose/plays, while
 * discoveries keep trickling in. Empty familiar list = pool unchanged.
 */
export function familiarWeave<T extends { artist: string }>(fam: T[], rest: T[], take: number): T[] {
  const out: T[] = [];
  let fi = 0;
  let ri = 0;
  while (out.length < take && (fi < fam.length || ri < rest.length)) {
    for (let k = 0; k < 2 && fi < fam.length && out.length < take; k++) out.push(fam[fi++]);
    if (ri < rest.length && out.length < take) out.push(rest[ri++]);
    if (fi >= fam.length) while (ri < rest.length && out.length < take) out.push(rest[ri++]); // drain when fam runs dry
  }
  return out;
}

/**
 * Day-seeded spotlight rotation: the featured slice of an artist list shifts
 * by one slot per day (deterministic — same day = same spotlight, no SSR
 * mismatch risk when callers seed by date). History-weighted ordering is the
 * caller's job; this only rotates, so the "Made for you" cast evolves daily
 * even before any listening happens.
 */
export function rotateBy<T>(arr: T[], daySeed: number): T[] {
  const n = arr.length;
  if (n <= 1) return arr;
  const r = ((daySeed % n) + n) % n;
  return [...arr.slice(r), ...arr.slice(0, r)];
}
