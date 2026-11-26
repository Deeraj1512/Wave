/**
 * Taste engine — the feed's ranking rules, as pure functions (unit-testable).
 *
 * The user's standing law, in his own words (v43): "no other language should be
 * there in feed other than selected language. Suppose I selected Telugu and
 * Tamil then Hindi songs should not be there in the feed… no Hindi song in feed
 * unless the language is selected."
 *
 * Three rules every feed surface obeys:
 *
 * 1. FEED LANGUAGES (feedLangs) — the languages the user SELECTED at onboarding,
 *    in pick order. History never ADDS languages to this set (a couple of stray
 *    plays must not reopen the door the user closed); it only re-ranks the
 *    picked ones. Without a profile the user's own play history defines the set.
 *
 * 2. STRICT LANGUAGE LOCK (strictLangFilter) — songs outside the feed languages
 *    are DROPPED, never kept as filler, never "1-2 at a time". The old
 *    progressive-trickle rule is retired. A song whose language cannot be
 *    detected is dropped too — EXCEPT when the pool itself was fetched under a
 *    feed language's query (a "sid sriram telugu songs" search), in which case
 *    the pool's own language may be presumed: the detection ladder
 *    (langs.trackLangOf) would have flagged ANY contradicting evidence.
 *
 * 3. TASTE ORDER (tasteOrder) — inside the allowed set: taste-language songs
 *    first (ranked by taste rank), then familiar artists promoted, then
 *    everything else; most-played wins ties.
 */

import type { Lang, Track } from "./types";
import { detectTrackLang, trackLangOf } from "./langs";
import { getProfile, profileArtists } from "./profile";
import { recentPlays, topArtists } from "./history";

// ── rule 1: the feed's language set (STRICT) ─────────────────────────────────

/**
 * The languages the feed may serve — SELECTED languages only. Profile picks in
 * pick order; history only sharpens their ORDER elsewhere, never the set. No
 * profile: the listener's own plays define taste (a language with ≥2 recent
 * plays qualifies). Empty (fresh install, nothing played): the feed is not yet
 * under contract and no filter applies.
 */
export function feedLangs(): Lang[] {
  const p = getProfile();
  if (p && !p.skipped && p.langs.length > 0) return [...p.langs];
  try {
    const counts = new Map<string, number>();
    for (const e of recentPlays(60)) {
      const l = (e.lang as Lang | undefined) ?? detectTrackLang({ title: e.title });
      if (!l) continue;
      counts.set(l, (counts.get(l) ?? 0) + Math.max(1, e.n ?? 1));
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([l]) => l);
  } catch {
    return [];
  }
}

/**
 * Listening weight per language (profile picks carry a pick-order floor; real
 * play history merges on top) — the ORDERING weights behind rankedTasteLangs.
 * Note: these weights order the SELECTED languages; they never admit a new
 * language into the feed (see feedLangs).
 */
export function tasteLangWeights(historyWeights?: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const picks = getProfile() && !getProfile()!.skipped ? getProfile()!.langs : [];
  // pick-order floor: #1 gets 5, each later pick 1 less (min 1)
  picks.forEach((l, i) => out.set(l, Math.max(1, 5 - i)));
  if (historyWeights) {
    for (const [l, w] of historyWeights) {
      out.set(l, (out.get(l) ?? 0) + w);
    }
  }
  return out;
}

// ── rule 2: the strict language lock ─────────────────────────────────────────

/**
 * Drop every song outside `langs` — hard. Detection runs the full strict ladder
 * (explicit field, markers, native script, movie/album fact, romanized title
 * words, decisive artist profiles). A song with NO detectable language is
 * dropped too, unless `opts.presumptive` names a feed language that the pool
 * itself was fetched under ("sid sriram telugu songs" → unknown rows are
 * presumed Telugu; any row the ladder DOES classify stays bound by the ladder).
 * Empty `langs` = no contract yet = pool unchanged (cold start).
 */
export function strictLangFilter<T extends { title: string; album?: string; artist?: string; lang?: Lang }>(
  pool: T[],
  langs: Lang[],
  opts: { presumptive?: Lang } = {}
): T[] {
  if (langs.length === 0) return pool;
  const allowed = new Set(langs);
  return pool.filter((t) => {
    const l = trackLangOf(t);
    if (l !== undefined) return allowed.has(l);
    if (opts.presumptive && allowed.has(opts.presumptive)) return true;
    return false; // unknown language never enters the feed
  });
}

/** In-taste check kept for callers that classify a single track (tests, chips). */
export function inTaste(
  t: { title: string; album?: string; artist?: string; lang?: Lang },
  langs: Lang[]
): boolean {
  const l = trackLangOf(t);
  if (l === undefined) return false; // strict: unknown counts as outside
  return langs.includes(l);
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
    const l = trackLangOf(t);
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
 * language pick order, so the shelf breathes Telugu → Tamil → Telugu exactly
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
