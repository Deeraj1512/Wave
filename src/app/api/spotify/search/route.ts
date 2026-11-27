import { NextRequest, NextResponse } from "next/server";
import { spotifyApi, spotifyConfigured } from "@/lib/spotify/serverAuth";
import type { SpTrackHit } from "@/lib/spotify/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cold-cache searches match up to 20 tracks through the YouTube chain — this
// can exceed Vercel Hobby's default 10s function cap (the reported "Couldn't
// reach Spotify" failure). Warm caches answer in ~1s; the cap only matters
// on the first query after a deploy/cold start.
export const maxDuration = 60;

/**
 * GET /api/spotify/search?q=&limit=&market=
 *
 * METADATA-ONLY Spotify search (type=track,artist,album,playlist). The route
 * is a pure proxy: the client secret stays in server env, and matching to
 * playable videoIds happens CLIENT-side (src/lib/spotify/match.ts → the app's
 * own originals-only YTM chain). Tracks ship with videoId=null and the app
 * fills them before rendering — matched ones play, unmatched render dimmed.
 * Artists and albums are plain Spotify entities: artists open the EXISTING
 * per-artist page by name, albums open the EXISTING YTM album page via entity
 * matching, playlists open Wave's Spotify playlist view, so no parallel
 * Spotify pages exist and the app's language/feed machinery keeps applying
 * everywhere.
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
interface SpApiPlaylist {
  id: string;
  name: string;
  owner?: { display_name?: string };
  tracks?: { total?: number };
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
    return NextResponse.json({ configured: false, tracks: [], artists: [], albums: [], playlists: [] });
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
      playlists?: { items: (SpApiPlaylist | null)[] };
    }>(
      `/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=${limit}&market=${encodeURIComponent(market)}`
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

    // Spotify search returns null playlist entries for blocked playlists —
    // skip them instead of shipping cards that 404 on open.
    const playlists = (data.playlists?.items ?? [])
      .filter((p): p is SpApiPlaylist => !!p && !!p.id)
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        title: p.name,
        owner: p.owner?.display_name ?? "Spotify",
        image: bestImage(p.images, 300),
        totalTracks: p.tracks?.total ?? 0,
      }));
    const tracks: SpTrackHit[] = spTracks.map((t) => ({
      spotifyId: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      albumName: t.album?.name ?? "",
      durationSec: Math.round(t.duration_ms / 1000),
      image: bestImage(t.album?.images, 640),
      popularity: t.popularity ?? 0,
      year: t.album?.release_date?.slice(0, 4),
      videoId: null, // matched client-side (match.ts) — this route stays a pure proxy
      confidence: 0,
    }));

    const out = { configured: true, tracks, artists, albums, playlists };
    cache.set(key, { at: Date.now(), data: out });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        tracks: [],
        artists: [],
        albums: [],
        playlists: [],
        error: e instanceof Error ? e.message : "spotify search failed",
      },
      { status: 502 }
    );
  }
}
