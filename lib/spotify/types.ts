/**
 * Spotify catalog entity shapes as the Wave app consumes them.
 *
 * The bridge (/api/spotify/* routes) does ALL Spotify work server-side — the
 * client secret lives in server env vars only — and hands the app fully
 * resolved entities. Tracks arrive pre-matched to playable YouTube videoIds,
 * so playback, queue, radio and history run on the EXISTING pipeline
 * unchanged (the YT IFrame engine / googlevideo chain never sees Spotify).
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
