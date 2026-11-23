import { NextRequest, NextResponse } from "next/server";
import { browseAlbum, resolveAlbumByName, searchAlbums, albumOfVideo, resolveAlbumForVideo } from "@/lib/yt/album";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Album access for the web client (the APK runs the same yt/album.ts chain
 * in-process). Three modes:
 *  ?browseId=MPREb_…  → the exact album page (title/artist/year/cover + full tracklist)
 *  ?videoId=…         → the EXACT album behind a song: YouTube's own song→album
 *                       linkage (watch-next seed row → MPREb_ run) then /browse.
 *                       This is the go-to-album path — never name-guessed.
 *  ?q=…&artist=…      → resolve the best-matching album entity for a name and
 *                       return its page; when nothing matches convincingly,
 *                       return the entity list so the UI can show cards.
 */
export async function GET(req: NextRequest) {
  const browseId = req.nextUrl.searchParams.get("browseId")?.trim();
  const videoId = req.nextUrl.searchParams.get("videoId")?.trim();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const artist = req.nextUrl.searchParams.get("artist")?.trim() ?? undefined;

  try {
    if (browseId) {
      const album = await browseAlbum(browseId);
      if (!album) return NextResponse.json({ error: "album not found" }, { status: 404 });
      return NextResponse.json({ album });
    }

    if (videoId) {
      const album = await resolveAlbumForVideo(videoId);
      if (album) return NextResponse.json({ album });
      // no album page — hand back the real album NAME YouTube reported (if any)
      // so the client can try the entity ladder on THAT name, not the song title
      const link = await albumOfVideo(videoId);
      return NextResponse.json({ albumName: link?.albumName ?? null });
    }

    if (q) {
      const album = await resolveAlbumByName(q, artist);
      if (album) return NextResponse.json({ album });
      // no confident single match → hand the entity cards over
      const albums = await searchAlbums(q);
      return NextResponse.json({ albums });
    }

    return NextResponse.json({ error: "missing browseId, videoId or q" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "album failed" }, { status: 502 });
  }
}
