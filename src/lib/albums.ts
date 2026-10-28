/**
 * Album search layer — the "type the album, find its songs" feature.
 *
 * Live YTM results already carry per-song album metadata (parsed from the
 * "Artist • Album • 4:29" byline), so albums are detected client-side by
 * grouping search results. A registered album's full tracklist is cached here
 * so the album page can render it; the cache is intentionally session-scoped
 * (albums only exist as search derivatives, never edited by the user).
 */
import type { Track } from "./types";

export interface AlbumMatch {
  key: string; // folded album name — stable id for the registry + navigation
  name: string;
  artist: string;
  tracks: Track[];
  cover?: string;
  score: number;
}

const albumCache = new Map<string, Track[]>();

export function registerAlbum(key: string, tracks: Track[]) {
  albumCache.set(key, tracks);
}

export function getAlbumTracks(key: string): Track[] | undefined {
  return albumCache.get(key);
}

/** Diacritic-strip + lowercase + whitespace collapse — same folding family as filters.fold. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Parser fallbacks that aren't real albums ("Single" placeholder from api.ts, etc.)
const GENERIC_ALBUM = /^(?:single|singles|ep|unknown|deleted|various)$/i;

/**
 * Is this track's parsed album name a REAL album (safe to list in the Library)?
 * Rejects the byline parser's fallbacks: empty, "Single", the song title itself,
 * and the raw artist string leaking into the album slot. Artist lists always
 * arrive comma-separated ("Mithoon, Arijit Singh & Shashaa Tirupati") — real
 * album titles are never comma-separated name lists, so the comma is the tell.
 */
export function isRealAlbumName(name: string, t: Track): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (GENERIC_ALBUM.test(n)) return false;
  if (n.includes(",")) return false;
  if (fold(n) === fold(t.title)) return false;
  if (fold(n) === fold(t.artist)) return false;
  return true;
}

/** "812M" / "1.2B" / "340K" → numeric, for tiebreak scoring. */
function playsToNum(p: string): number {
  const m = p.trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const mult = m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1;
  return (parseFloat(m[1]) || 0) * mult;
}

/**
 * Group search results into album candidates worth showing.
 * A group qualifies when the album collected ≥2 distinct songs in the results,
 * or the query itself points at the album name (single-song albums like
 * non-movie singles still surface when the user typed the album name).
 */
export function groupAlbums(results: Track[], query: string): AlbumMatch[] {
  const q = fold(query);
  const qToks = q.split(" ").filter((w) => w.length > 1);

  const groups = new Map<string, Track[]>();
  for (const t of results) {
    const name = (t.album || "").trim();
    if (!name || GENERIC_ALBUM.test(name)) continue;
    if (fold(name) === fold(t.title)) continue; // byline fallback, not a real album
    const k = fold(name);
    const arr = groups.get(k);
    if (arr) {
      if (!arr.some((x) => x.id === t.id)) arr.push(t);
    } else {
      groups.set(k, [t]);
    }
  }

  const out: AlbumMatch[] = [];
  for (const [k, tracks] of groups) {
    const strongQueryMatch =
      q.length > 1 && (q === k || k.includes(q) || (qToks.length > 0 && qToks.every((w) => k.includes(w))));
    if (tracks.length < 2 && !strongQueryMatch) continue;
    const artist = tracks.map((t) => t.artist).find((a) => a && a !== "Unknown artist") ?? "";
    const views = tracks.reduce((s, t) => s + playsToNum(t.plays), 0);
    out.push({
      key: k,
      name: tracks[0].album.trim(),
      artist,
      tracks,
      cover: tracks.find((t) => t.cover)?.cover,
      score: (strongQueryMatch ? 10_000 : 0) + tracks.length * 100 + views / 1e6,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}
