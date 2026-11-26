import { NextRequest, NextResponse } from "next/server";
import { isGated, spotifyApi } from "@/lib/spotify/serverAuth";
import { artistIdByName } from "@/lib/spotify/serverResolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/related?artist=Name&market=
 *
 * PHASE 3 — "fans also like": Spotify's related-artists for the listener's
 * top artist. Gated for apps not in Extended Quota Mode (403/404 since the
 * Nov 2024 API changes) — the route answers { available: false } in that
 * case and the UI hides the row instead of erroring. When Extended Quota is
 * granted it starts working with zero code changes.
 */

interface SpApiImage { url: string; width: number; height: number }
interface SpApiArtist {
  id: string;
  name: string;
  images?: SpApiImage[];
  followers?: { total?: number };
}

function bestImage(images: SpApiImage[] | undefined, want: number): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) ?? sorted[sorted.length - 1]).url;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("artist")?.trim();
  if (!name) return NextResponse.json({ available: false, artists: [], reason: "missing artist" });
  const market = req.nextUrl.searchParams.get("market") || "IN";

  const id = await artistIdByName(name, market);
  if (!id) return NextResponse.json({ available: false, artists: [], reason: "artist not found" });

  try {
    const data = await spotifyApi<{ artists: SpApiArtist[] }>(
      `/artists/${encodeURIComponent(id)}/related-artists`
    );
    const artists = (data.artists ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      name: a.name,
      image: bestImage(a.images, 300),
      followers: a.followers?.total,
    }));
    return NextResponse.json({ available: true, artists });
  } catch (e) {
    const reason = isGated(e) ? "gated (needs Extended Quota)" : e instanceof Error ? e.message : "related failed";
    return NextResponse.json({ available: false, artists: [], reason });
  }
}
