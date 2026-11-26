import { IS_NATIVE } from "../api";

/**
 * Spotify bridge configuration.
 *
 * The Spotify CLIENT SECRET must never ship inside the APK or the browser —
 * Client Credentials tokens are minted in the BRIDGE only: a tiny Cloudflare
 * Worker (bridge/ in the repo) deployed automatically by GitHub Actions
 * (.github/workflows/deploy-bridge.yml). SPOTIFY_CLIENT_ID /
 * SPOTIFY_CLIENT_SECRET live as Worker secrets; nothing is hosted on Netlify
 * or any website — the app itself remains repo → Actions → APK.
 *
 *  - WEB runtime (dev): same-origin — "/api/spotify".
 *  - APK runtime: the app has no server, so Spotify calls go to the Worker
 *    bridge over native HTTP (CapacitorHttp → no CORS). Set the Worker origin
 *    at APK build time via NEXT_PUBLIC_SPOTIFY_BRIDGE_URL (a GitHub Actions
 *    repository VARIABLE is passed through by android.yml), or edit the
 *    fallback constant below and push.
 */
export const SPOTIFY_BRIDGE_ORIGIN = (
  process.env.NEXT_PUBLIC_SPOTIFY_BRIDGE_URL || ""
).trim();

export function spotifyBridgeBase(): string {
  if (!IS_NATIVE) return "/api/spotify";
  const origin = SPOTIFY_BRIDGE_ORIGIN.replace(/\/+$/, "");
  return origin ? `${origin}/api/spotify` : "";
}
