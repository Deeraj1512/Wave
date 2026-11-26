/**
 * SERVER ONLY — shared seed resolvers for the /api/spotify routes:
 * artist display-name → Spotify artist id, and the available-genre-seeds
 * validation. Both cached 24h in memory (artist ids and the genre list are
 * effectively static; the cache also shields the quota from repeat calls).
 */

import { spotifyApi } from "./serverAuth";

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

interface SpApiArtist { id: string; name: string }

const artistIdCache = new Map<string, { at: number; id: string | null }>();
const ARTIST_ID_TTL = 24 * 60 * 60 * 1000;

/** Resolve an artist display name to a Spotify id (exact fold match preferred). */
export async function artistIdByName(name: string, market: string): Promise<string | null> {
  const key = `${name.toLowerCase()}|${market}`;
  const hit = artistIdCache.get(key);
  if (hit && Date.now() - hit.at < ARTIST_ID_TTL) return hit.id;
  try {
    const data = await spotifyApi<{ artists: { items: SpApiArtist[] } }>(
      `/search?q=${encodeURIComponent(name)}&type=artist&limit=3&market=${encodeURIComponent(market)}`
    );
    const items = data.artists?.items ?? [];
    const exact = items.find((a) => fold(a.name) === fold(name));
    const id = (exact ?? items[0])?.id ?? null;
    artistIdCache.set(key, { at: Date.now(), id });
    return id;
  } catch {
    artistIdCache.set(key, { at: Date.now(), id: null });
    return null;
  }
}

let genreSeedsCache: { at: number; genres: Set<string> } | null = null;
const GENRE_TTL = 24 * 60 * 60 * 1000;

/**
 * The valid genre seeds, or null when the endpoint is unreachable — which in
 * practice means the app is quota-gated and /recommendations would 403 too,
 * so callers skip straight to their fallback lane.
 */
export async function validGenreSeeds(): Promise<Set<string> | null> {
  if (genreSeedsCache && Date.now() - genreSeedsCache.at < GENRE_TTL) return genreSeedsCache.genres;
  try {
    const data = await spotifyApi<{ genres: string[] }>("/recommendations/available-genre-seeds");
    const set = new Set(data.genres.map((g) => g.toLowerCase()));
    genreSeedsCache = { at: Date.now(), genres: set };
    return set;
  } catch {
    return null;
  }
}
