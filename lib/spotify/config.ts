import { IS_NATIVE } from "../api";

/**
 * Spotify bridge configuration.
 *
 * The Spotify CLIENT SECRET must never ship inside the APK or the browser —
 * Client Credentials tokens are minted on the SERVER only (the Next.js API
 * routes under /api/spotify/*, which run on the deployed Wave site, e.g.
 * Netlify — set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET there).
 *
 *  - WEB runtime: same-origin — "/api/spotify".
 *  - APK runtime: the app has no server, so Spotify calls go to the DEPLOYED
 *    Wave site's bridge over native HTTP (CapacitorHttp → no CORS). Set the
 *    site origin at APK build time via NEXT_PUBLIC_SPOTIFY_BRIDGE_URL
 *    (a GitHub Actions repository VARIABLE is passed through by android.yml),
 *    or edit the fallback constant below and push.
 */
export const SPOTIFY_BRIDGE_ORIGIN = (
  process.env.NEXT_PUBLIC_SPOTIFY_BRIDGE_URL || ""
).trim();

export function spotifyBridgeBase(): string {
  if (!IS_NATIVE) return "/api/spotify";
  const origin = SPOTIFY_BRIDGE_ORIGIN.replace(/\/+$/, "");
  return origin ? `${origin}/api/spotify` : "";
}
