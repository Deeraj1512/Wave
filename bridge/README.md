# Wave Spotify bridge

A tiny metadata-only Cloudflare Worker. It holds the Spotify **client secret**
(in Cloudflare env vars — never in the APK, never in this repo) and answers
the four endpoints the app's Spotify layer consumes:

| Endpoint              | What it returns                                    |
| --------------------- | -------------------------------------------------- |
| `/api/spotify/status` | `{ configured }` — the app's availability probe    |
| `/api/spotify/search` | Spotify tracks / artists / albums (metadata only)  |
| `/api/spotify/picks`  | Phase 3 recommendations (fallback lane on 403)     |
| `/api/spotify/related`| Phase 3 fans-also-like (hidden while quota-gated)  |

Matching Spotify tracks to playable YouTube videoIds happens **in the app**
(`src/lib/spotify/match.ts`) over Wave's own YouTube Music chain — this
worker never touches YouTube.

## Deploy (automatic, from GitHub)

The workflow `.github/workflows/deploy-bridge.yml` deploys on every push that
touches `bridge/**` (and on manual dispatch). One-time setup, about 10
minutes:

1. **Cloudflare** (free): create an account at dash.cloudflare.com.
   - Copy **Account ID** (dashboard right rail).
   - My Profile → API Tokens → Create Token → template **"Edit Cloudflare
     Workers"** → create, copy the token.

2. **Spotify** (free): developer.spotify.com/dashboard → Create app
   (name `Wave`, which API: **Web API**, no redirect URIs — Client
   Credentials only). Copy **Client ID** and **Client Secret**.

3. **GitHub repo** → Settings → Secrets and variables → Actions →
   **Secrets** tab → New repository secret, four times:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`

4. Run the **Spotify bridge (Cloudflare Worker)** workflow once (Actions →
   Run workflow). The deploy step's log prints the public URL:
   `https://wave-bridge.<your-subdomain>.workers.dev`

5. **GitHub repo** → Settings → Secrets and variables → Actions →
   **Variables** tab → New repository variable:
   - `NEXT_PUBLIC_SPOTIFY_BRIDGE_URL` = `https://wave-bridge.<your-subdomain>.workers.dev`
   (no trailing slash). `android.yml` passes it into the APK build.

6. Re-run the **Android APK** workflow. The APK now bakes in the bridge
   origin and the Spotify tab appears.

Until step 5 is done the app behaves exactly as before — the Spotify tab
stays hidden because `/status` is unreachable or answers `configured:false`.
Nothing breaks, YouTube playback is untouched.
