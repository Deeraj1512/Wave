/**
 * CLIENT-SIDE — the listener's OWN Spotify data (Phase 2 surfaces): top
 * artists, top tracks, saved tracks, user playlists, playlist tracklists.
 *
 * These endpoints are USER-scoped — they run on the device with the PKCE
 * login token (userAuth.ts), straight against api.spotify.com (CapacitorHttp
 * native → no CORS; Spotify's API also allows browser CORS for the web dev
 * runtime). None of them involve the client secret, so the bridge never
 * proxies them.
 *
 * Dev-mode reality (Nov 2024 API changes): /me/top/*, /me/tracks, /me/playlists
 * and /playlists/{id}/tracks all work with a user token — unlike
 * /recommendations and related-artists, which stay gated. So the personal
 * library is fully available; the recommendation ENGINE keeps its fallback
 * lane (picks route).
 *
 * All track results are metadata-only here — they pass through attachMatches
 * (client-side matcher) before reaching the UI, so everything plays through
 * Wave's existing YouTube-audio pipeline.
 */

import { attachMatches } from "./bridge";
import { spotifyUserToken, spotifyUserTokenFresh } from "./userAuth";
import type { SpArtistLite, SpPlaylistLite, SpTrackHit } from "./types";

interface SpApiImage { url: string; width: number; height: number }
interface SpApiArtist {
  id: string;
  name: string;
  images?: SpApiImage[];
  followers?: { total?: number };
}
interface SpApiTrack {
  id: string | null;
  name: string;
  duration_ms: number;
  popularity?: number;
  artists: { name: string }[];
  album?: { name?: string; release_date?: string; images?: SpApiImage[] };
}
interface SpApiPlaylist {
  id: string;
  name: string;
  owner?: { display_name?: string };
  tracks?: { total?: number };
  images?: SpApiImage[];
}

function bestImage(images: SpApiImage[] | undefined, want: number): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) ?? sorted[sorted.length - 1]).url;
}

function toHit(t: SpApiTrack): SpTrackHit {
  return {
    spotifyId: t.id ?? `local-${t.name}`,
    title: t.name,
    artist: (t.artists ?? []).map((a) => a.name).join(", "),
    albumName: t.album?.name ?? "",
    durationSec: Math.round(t.duration_ms / 1000),
    image: bestImage(t.album?.images, 640),
    popularity: t.popularity ?? 0,
    year: t.album?.release_date?.slice(0, 4),
    videoId: null,
    confidence: 0,
  };
}

/** GET a Spotify user endpoint with the login token; one transparent retry
 *  after a forced refresh when the token was rejected. */
async function spUserGet<T>(path: string): Promise<T> {
  const call = async (token: string) => {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return res;
  };
  let res = await call(await spotifyUserToken());
  if (res.status === 401) {
    res = await call(await spotifyUserTokenFresh());
  }
  if (!res.ok) throw new Error(`spotify ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export type TimeRange = "short_term" | "medium_term" | "long_term";

/** "Your top artists" — the listener's most-played artists on Spotify. */
export async function spotifyTopArtists(limit = 10, range: TimeRange = "medium_term"): Promise<SpArtistLite[]> {
  const data = await spUserGet<{ items: SpApiArtist[] }>(
    `/me/top/artists?limit=${Math.min(50, limit)}&time_range=${range}`
  );
  return (data.items ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    image: bestImage(a.images, 300),
    followers: a.followers?.total,
  }));
}

/** "Your top tracks" — matched to YouTube audio before returning. */
export async function spotifyTopTracks(limit = 20, range: TimeRange = "medium_term"): Promise<SpTrackHit[]> {
  const data = await spUserGet<{ items: SpApiTrack[] }>(
    `/me/top/tracks?limit=${Math.min(50, limit)}&time_range=${range}`
  );
  return attachMatches((data.items ?? []).filter((t) => t && t.id).map(toHit));
}

/** "Saved on Spotify" — the user's library tracks (liked songs), matched. */
export async function spotifySavedTracks(limit = 30): Promise<SpTrackHit[]> {
  const data = await spUserGet<{ items: { track: SpApiTrack }[] }>(
    `/me/tracks?limit=${Math.min(50, limit)}`
  );
  return attachMatches(
    (data.items ?? []).map((i) => i.track).filter((t) => t && t.id).map(toHit)
  );
}

/** "Your playlists" — user-owned + followed playlists (dev mode: this user's). */
export async function spotifyUserPlaylists(limit = 20): Promise<SpPlaylistLite[]> {
  const data = await spUserGet<{ items: (SpApiPlaylist | null)[] }>(
    `/me/playlists?limit=${Math.min(50, limit)}`
  );
  return (data.items ?? [])
    .filter((p): p is SpApiPlaylist => !!p && !!p.id)
    .map((p) => ({
      id: p.id,
      title: p.name,
      owner: p.owner?.display_name ?? "Spotify",
      image: bestImage(p.images, 300),
      totalTracks: p.tracks?.total ?? 0,
    }));
}

/**
 * Tracklist of a playlist the logged-in user can read (their own, followed,
 * or public — this ALSO covers public playlists, so the same helper serves
 * the login-free search flow through the bridge when no token exists).
 * Matched to YouTube audio before returning.
 */
export async function spotifyPlaylistTracks(id: string, limit = 100): Promise<SpTrackHit[]> {
  const data = await spUserGet<{ items: { track: SpApiTrack | null }[] }>(
    `/playlists/${encodeURIComponent(id)}/tracks?limit=${Math.min(100, limit)}`
  );
  return attachMatches(
    (data.items ?? [])
      .map((i) => i.track)
      .filter((t): t is SpApiTrack => !!t && !!t.id)
      .map(toHit)
  );
}
