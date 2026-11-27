import { NextRequest, NextResponse } from "next/server";
import { spotifyApi, spotifyConfigured } from "@/lib/spotify/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spotify/playlist?id=&limit=
 *
 * One Spotify playlist page (app-token, public playlists): metadata + up to
 * 100 track METADATA rows (videoId=null — matching happens client-side via
 * match.ts, exactly like /search). Same shape as the Cloudflare Worker's
 * /api/spotify/playlist — keep the two in sync.
 */

interface SpApiImage { url: string; width: number; height: number }
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

function toHit(t: SpApiTrack) {
  return {
    spotifyId: t.id ?? `local-${t.name}`,
    title: t.name,
    artist: (t.artists ?? []).map((a) => a.name).join(", "),
    albumName: t.album?.name ?? "",
    durationSec: Math.round(t.duration_ms / 1000),
    image: bestImage(t.album?.images, 640),
    popularity: t.popularity ?? 0,
    year: t.album?.release_date?.slice(0, 4),
    videoId: null as string | null,
    confidence: 0,
  };
}

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id || !/^[A-Za-z0-9]{16,30}$/.test(id)) {
    return NextResponse.json({ error: "missing/invalid id" }, { status: 400 });
  }
  if (!spotifyConfigured()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "100", 10) || 100));

  const key = `${id}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ ...(hit.data as object), cached: true });
  }

  try {
    const meta = await spotifyApi<SpApiPlaylist>(
      `/playlists/${encodeURIComponent(id)}?fields=id,name,owner.display_name,images,tracks.total`
    );
    const tracksRes = await spotifyApi<{ items: { track: SpApiTrack | null }[] }>(
      `/playlists/${encodeURIComponent(id)}/tracks?limit=${limit}`
    );
    const tracks = (tracksRes.items ?? [])
      .map((i) => i.track)
      .filter((t): t is SpApiTrack => !!t && !!t.id)
      .map(toHit);
    const out = {
      playlist: {
        id: meta.id,
        title: meta.name,
        owner: meta.owner?.display_name ?? "Spotify",
        image: bestImage(meta.images, 300),
        totalTracks: meta.tracks?.total ?? tracks.length,
      },
      tracks,
    };
    cache.set(key, { at: Date.now(), data: out });
    return NextResponse.json(out);
  } catch (e) {
    const status = (e as { status?: number })?.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "spotify playlist failed" },
      { status }
    );
  }
}
