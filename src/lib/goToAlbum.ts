/**
 * "Go to album" — resolves the album behind ANY song and opens its tracklist.
 *
 * Resolution ladder (never throws, toast on false):
 *  0. EXACT LINKAGE — YouTube's own song→album metadata: the watch-next seed
 *     row for the track's videoId carries the album as an MPREb_ run; /browse
 *     on it returns the real album page. This is THE path — name-searching
 *     was removed as a primary lane after it opened junk albums that merely
 *     SHARE the song's name ("Chitti" → a 229-play album named "Chitti").
 *  1. fast path — the album registry already holds this album this session;
 *  2. entity path — album NAME search (now seeded with the linkage's real
 *     album name, artist bias can no longer override the title match), then
 *     /browse returns the real album page with its complete official tracklist;
 *  3. legacy fallback — song-name search grouped by parsed album bylines,
 *     kept for catalog/library tracks the entity search can't find.
 *
 * YTM singles matter: an album slot of "Single" or a name equal to the song
 * title is usually a real single-release page — the menu now OFFERS "Go to
 * album" for those (it was hidden before, the user noticed) and resolves it
 * through the same exact chain.
 */

import { searchApi, albumSearchApi, albumBrowseApi, albumForVideoApi } from "./api";
import { getAlbumTracks, isRealAlbumName, registerAlbum } from "./albums";
import type { Track } from "./types";

/** Fired with the folded album key — page.tsx navigates to the album screen. */
export const OPEN_ALBUM_EVENT = "wave:open-album";

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const GENERIC_ALBUM = /^(?:single|singles|ep|unknown|deleted|various)$/i;

/** True when the song carries a REAL album name (not "Single" / its own title). */
export function canGoToAlbum(t: Track): boolean {
  const album = (t.album || "").trim();
  const artist = (t.artist || "").trim();
  if (isRealAlbumName(album, t)) return true;
  // "Single"/title-equal album slot with a known artist → the exact chain can
  // still resolve the single's release page — offer the menu item.
  if (!album || GENERIC_ALBUM.test(album) || fold(album) === fold(t.title)) return artist.length > 0;
  return false;
}

/** Entity title matches the album name we're hunting (folded, both directions). */
function entityMatches(entityTitle: string, name: string): boolean {
  const a = fold(entityTitle);
  const b = fold(name);
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

/**
 * Resolve + open the album for `track`. Resolves false when nothing matched —
 * callers show a toast; it never throws.
 *
 * Step 0 is YouTube's OWN song→album linkage (watch-next seed row → MPREb_
 * album run → exact album page). It made name-guessing obsolete: resolving
 * "Chitti" (Jathi Ratnalu) by title search used to open a junk 229-play
 * album of the same name — the linkage lands the movie's real album every
 * time, because it never searches by name at all.
 */
export async function openAlbumFor(track: Track): Promise<boolean> {
  const name = (track.album || "").trim();
  const artistFirst = track.artist.split(",")[0].trim();

  // ── step 0: the EXACT linkage, straight from YouTube for this videoId ──────
  const linked = await albumForVideoApi(track.id).catch(() => null);
  if (linked?.page) {
    const pageKey = fold(linked.page.album.title);
    if (pageKey && linked.page.tracks.length > 0) {
      registerAlbum(pageKey, linked.page.tracks);
      // the parsed album slot may spell it differently ("Jathiratnalu" vs
      // "Jathi Ratnalu") — that key resolves to the same page too
      const parsed = fold(name);
      if (parsed && parsed !== pageKey && isRealAlbumName(name, track)) registerAlbum(parsed, linked.page.tracks);
      announce(pageKey);
      return true;
    }
  }

  // ── candidate album names, best first ──────────────────────────────────────
  // YouTube's own album name for this video (when the linkage gave a name but
  // no page) beats every guess; then the parsed album, then — last resort —
  // the song title (YTM single releases are titled like the song).
  const candidates: string[] = [];
  const push = (s?: string) => {
    const v = (s || "").trim();
    if (v && !candidates.some((c) => fold(c) === fold(v))) candidates.push(v);
  };
  if (linked?.albumName && isRealAlbumName(linked.albumName, track)) push(linked.albumName);
  if (isRealAlbumName(name, track)) push(name);
  push(track.title);

  for (const cand of candidates) {
    // 1. fast path — registered earlier this session
    const key = fold(cand);
    if ((getAlbumTracks(key)?.length ?? 0) >= 2) {
      announce(key);
      return true;
    }

    // 2. exact path — album entity search + /browse page. A candidate is only
    //    accepted when its TITLE matches the candidate (the old artist-bias
    //    first-pick opened a different album by the same singer).
    const entities = await albumSearchApi(cand, artistFirst || undefined).catch(() => []);
    for (const e of entities.slice(0, 3)) {
      if (!entityMatches(e.title, cand)) continue;
      const page = await albumBrowseApi(e.browseId).catch(() => null);
      if (!page || page.tracks.length === 0) continue;
      const pageKey = fold(page.album.title);
      registerAlbum(pageKey, page.tracks);
      if (pageKey !== key) registerAlbum(key, page.tracks); // requested name resolves too
      announce(pageKey);
      return true;
    }
  }

  // 3. legacy fallback — grouped song search (catalog/library tracks)
  if (isRealAlbumName(name, track)) {
    const ok = await legacyGroupOpen(name, artistFirst, track);
    if (ok) return true;
  }
  return false;
}

function announce(key: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_ALBUM_EVENT, { detail: key }));
  }
}

/** The original search-and-group resolution, kept as the fallback lane. */
async function legacyGroupOpen(name: string, artistFirst: string, track: Track): Promise<boolean> {
  const key = fold(name);
  if (!key) return false;
  const queries = [`${name} ${artistFirst}`, `${name} album`, name];
  const collected: Track[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const res = await searchApi(q).catch(() => [] as Track[]);
    for (const t of res) {
      if (seen.has(t.id) || t.duration < 45) continue;
      const albumFold = fold((t.album || "").trim());
      if (!albumFold) continue;
      const belongs =
        albumFold === key ||
        (albumFold.length >= 4 && albumFold.includes(key)) ||
        (key.length >= 4 && key.includes(albumFold));
      if (belongs) {
        seen.add(t.id);
        collected.push(t);
      }
    }
    if (collected.length >= 4) break; // enough of the album surfaced
  }

  // dead end (bot-gated search / true single) → the tapped song alone still
  // opens a real page; never leave the user on an error
  if (collected.length === 0) collected.push(track);

  registerAlbum(key, collected);
  announce(key);
  return true;
}
