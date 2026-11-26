import { NextResponse } from "next/server";
import { spotifyConfigured, spotifyHealthy } from "@/lib/spotify/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The availability probe the app calls once per session to decide whether
 *  the Spotify tab exists at all. configured=false → the UI hides Spotify
 *  entirely (Wave stays a pure YTM app until env vars are set). */
export async function GET() {
  if (!spotifyConfigured()) return NextResponse.json({ configured: false });
  const ok = await spotifyHealthy();
  return NextResponse.json({ configured: ok });
}
