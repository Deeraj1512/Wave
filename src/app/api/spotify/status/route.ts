import { NextResponse } from "next/server";
import { spotifyConfigured, spotifyHealthy } from "@/lib/spotify/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The search/picks/match routes spend up to tens of seconds matching tracks
// through the YouTube chain on a cold cache — on Vercel's Hobby tier the
// default cap is 10s, which is exactly the "Couldn't reach Spotify" timeout
// users saw on their first search. Lift every Spotify route to 60s.
export const maxDuration = 60;

/** The availability probe the app calls once per session to decide whether
 *  the Spotify tab exists at all. configured=false → the UI hides Spotify
 *  entirely (Wave stays a pure YTM app until env vars are set).
 *
 *  Also returns `clientId` — the PUBLIC application id, needed by the app's
 *  Authorization Code + PKCE login (no secret is involved in PKCE; embedding
 *  the client id in a response is standard Spotify client design). */
export async function GET() {
  if (!spotifyConfigured()) return NextResponse.json({ configured: false });
  const ok = await spotifyHealthy();
  const clientId = (process.env.SPOTIFY_CLIENT_ID || "").trim();
  return NextResponse.json({ configured: ok, clientId: ok ? clientId : "" });
}
