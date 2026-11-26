import { NextRequest, NextResponse } from "next/server";
import { spotifyApi, spotifyConfigured } from "@/lib/spotify/serverAuth";
import { matchSpotifyBatch } from "@/lib/spotify/serverMatch";
import type { SpTrackHit } from "@/lib/spotify/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/search?q=&limit=&market=
 *
 * One Spotify search (type=track,artist,album) + the matcher. Tracks come
 * back pre-matched to playable videoIds (videoId=null when the matcher had
 * no confident candidate — the UI renders those dimmed). Artists and albums
 * are plain Spotify entities: artists open the EXISTING per-artist page by
 * name, albums open the EXISTING YTM album page via entity matching, so no
 * parallel Spotify pages exist and the app's language/feed machinery keeps
 * applying everywhere.
 */

interface SpApiImage { url: string; width: number; height: number }
interface SpApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  popularity: number;
  artists: { id: string; name: string }[];
  album?: { name?: string; release_date?: string; images?: SpApiImage[] };
}
interface SpApiArtist {
  id: string;
  name: string;
  images?: SpApiImage[];
  followers?: { total?: number };
}
interface SpApiAlbum {
  id: string;
  name: string;
  release_date?: string;
  total_tracks?: number;
  artists?: { name: string }[];
  images?: SpApiImage[];
}

/** Smallest image at ≥ want px (fallback: the largest available). */
function bestImage(images: SpApiImage[] | undefined, want: number): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) ?? sorted[sorted.length - 1]).url;
}

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });
  if (!spotifyConfigured()) {
    return NextResponse.json({ configured: false, tracks: [], artists: [], albums: [] });
  }
  const market = req.nextUrl.searchParams.get("market") || "IN";
  const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "20", 10) || 20));

  const key = `${q.toLowerCase()}|${limit}|${market}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ ...(hit.data as object), cached: true });
  }

  try {
    const data = await spotifyApi<{
      tracks?: { items: SpApiTrack[] };
      artists?: { items: SpApiArtist[] };
      albums?: { items: SpApiAlbum[] };
    }>(
      `/search?q=${encodeURIComponent(q)}&type=track,artist,album&limit=${limit}&market=${encodeURIComponent(market)}`
    );

    const artists = (data.artists?.items ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      name: a.name,
      image: bestImage(a.images, 300),
      followers: a.followers?.total,
    }));

    const albums = (data.albums?.items ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      title: a.name,
      artist: a.artists?.[0]?.name ?? "",
      year: a.release_date?.slice(0, 4),
      image: bestImage(a.images, 300),
      totalTracks: a.total_tracks,
    }));

    const spTracks = (data.tracks?.items ?? []).slice(0, limit);
    const matches = await matchSpotifyBatch(
      spTracks.map((t) => ({
        id: t.id,
        name: t.name,
        durationMs: t.duration_ms,
        artists: t.artists.map((a) => a.name),
      }))
    );

    const tracks: SpTrackHit[] = spTracks.map((t, i) => ({
      spotifyId: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      albumName: t.album?.name ?? "",
      durationSec: Math.round(t.duration_ms / 1000),
      image: bestImage(t.album?.images, 640),
      popularity: t.popularity ?? 0,
      year: t.album?.release_date?.slice(0, 4),
      videoId: matches[i]?.videoId ?? null,
      confidence: matches[i]?.confidence ?? 0,
    }));

    const out = { configured: true, tracks, artists, albums };
    cache.set(key, { at: Date.now(), data: out });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        tracks: [],
        artists: [],
        albums: [],
        error: e instanceof Error ? e.message : "spotify search failed",
      },
      { status: 502 }
    );
  }
}
