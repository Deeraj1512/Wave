import { NextRequest, NextResponse } from "next/server";
import { browseAlbum, resolveAlbumByName, searchAlbums } from "@/lib/yt/album";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Album access for the web client (the APK runs the same yt/album.ts chain
 * in-process). Two modes:
 *  ?browseId=MPREb_…  → the exact album page (title/artist/year/cover + full tracklist)
 *  ?q=…&artist=…      → resolve the best-matching album entity for a name and
 *                       return its page; when nothing matches convincingly,
 *                       return the entity list so the UI can show cards.
 */
export async function GET(req: NextRequest) {
  const browseId = req.nextUrl.searchParams.get("browseId")?.trim();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const artist = req.nextUrl.searchParams.get("artist")?.trim() ?? undefined;

  try {
    if (browseId) {
      const album = await browseAlbum(browseId);
      if (!album) return NextResponse.json({ error: "album not found" }, { status: 404 });
      return NextResponse.json({ album });
    }

    if (q) {
      const album = await resolveAlbumByName(q, artist);
      if (album) return NextResponse.json({ album });
      // no confident single match → hand the entity cards over
      const albums = await searchAlbums(q);
      return NextResponse.json({ albums });
    }

    return NextResponse.json({ error: "missing browseId or q" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "album failed" }, { status: 502 });
  }
}
