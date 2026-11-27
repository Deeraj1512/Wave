/**
 * Spotify catalog entity shapes as the Wave app consumes them.
 *
 * The bridge (Cloudflare Worker in production, /api/spotify/* dev routes on
 * web) is a METADATA-ONLY Spotify proxy — the client secret lives in server
 * env only, and NO YouTube involvement server-side. Matching metadata to
 * playable videoIds happens in the app (match.ts) over Wave's own originals-
 * only YTM chain, so playback, queue, radio and history run on the EXISTING
 * pipeline unchanged.
 */

export interface SpotifyImage {
  url: string;
  width: number;
  height: number;
}

/** Artist chip (search results / "fans also like"). */
export interface SpArtistLite {
  id: string;
  name: string;
  image?: string;
  followers?: number;
}

/** Album card (search results) — opens the EXISTING YTM album page via entity matching. */
export interface SpAlbumLite {
  id: string;
  title: string;
  artist: string;
  year?: string;
  image?: string;
  totalTracks?: number;
}

/** Playlist card (search results / user playlists) — opens Wave's Spotify playlist view. */
export interface SpPlaylistLite {
  id: string;
  title: string;
  owner: string;
  image?: string;
  totalTracks?: number;
}

/** Full playlist page: metadata + its tracks (metadata-only; the app matches them). */
export interface SpPlaylistResult {
  playlist: SpPlaylistLite;
  tracks: SpTrackHit[];
}

/** A Spotify track resolved (matched) to a playable Wave track. */
export interface SpTrackHit {
  spotifyId: string;
  title: string;
  artist: string;
  albumName: string;
  durationSec: number;
  image?: string;
  /** Spotify 0-100 popularity — display only, never played as a count. */
  popularity: number;
  year?: string;
  /** The matched YouTube videoId — null when no confident match was found. */
  videoId: string | null;
  /** 0..1 matcher confidence (1 = exact). Only meaningful when videoId is set. */
  confidence: number;
}

export interface SpSearchResult {
  configured: boolean;
  tracks: SpTrackHit[];
  artists: SpArtistLite[];
  albums: SpAlbumLite[];
  playlists?: SpPlaylistLite[];
  cached?: boolean;
  error?: string;
}

export interface SpPicksResult {
  available: boolean;
  /** "recommendations" = Spotify's own engine (needs Extended Quota);
   *  "fallback" = popularity-ranked search built from the same seeds. */
  source: "recommendations" | "fallback";
  tracks: SpTrackHit[];
  reason?: string;
}

export interface SpRelatedResult {
  available: boolean;
  artists: SpArtistLite[];
  reason?: string;
}
