# Wave × Spotify — setup (search, your library, picks, playlists)

Wave keeps playing **YouTube audio** through its existing Echo chain / IFrame
engine. Spotify adds **catalog quality**: real studio metadata, proper
artwork (300 px cards / 640 px detail images), search that understands
official releases, YOUR Spotify library (playlists / saved songs / top
artists) and personalized picks. The app never plays "from Spotify" — every
Spotify track is matched to a YouTube videoId by the on-device matcher
(official uploads only) before it reaches the player.

```
Wave APK (WebView + MediaPlaybackService)
   │  HTTPS (CapacitorHttp — no CORS)
   ▼
Cloudflare Worker bridge (bridge/ in this repo, auto-deployed by GitHub Actions)
   ├─ /status      probe + PUBLIC client id (for the in-app login)
   ├─ /search      tracks + artists + albums + PLAYLISTS (metadata only)
   ├─ /playlist    one playlist page (metadata only)
   ├─ /picks       recommendations (falls back to popularity search while gated)
   ├─ /related     fans-also-like (hidden while gated)
   └─ SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET live in Worker secrets ONLY
        │
        ▼  (your library: /me/* endpoints run ON DEVICE with your login token)
Spotify login = Authorization Code + PKCE in the system browser — NO secret
involved; tokens stay in the app. Matching to YouTube happens in the app
(src/lib/spotify/match.ts) over the same originals-only chain search uses.
```

## Step 1 — Spotify app in the Developer Dashboard

1. https://developer.spotify.com/dashboard → your `Wave` app (or Create app).
2. **Which API/SDKs are you planning to use?** tick **Web API** only.
3. **Redirect URIs** — BOTH of these, exact, no trailing slash:
   - `com.deeraj.wave://callback`  (in-app login — deep links back into Wave)
   - `http://127.0.0.1:3000/callback`  (web dev runtime)
4. **User Management** (left sidebar of the app page): **Add the email of the
   Spotify account you will log in with.** In Development Mode ONLY these
   allow-listed users can sign in — skipping this makes the login fail.
   (Up to 25 users; for a private app this IS the access control.)
5. Copy the **Client ID** and **Client Secret** — they go into GitHub secrets
   in step 2, nowhere else.

## Step 2 — Deploy the bridge (automatic, from GitHub)

The bridge is a tiny Cloudflare Worker in `bridge/`, deployed by the
**Spotify bridge (Cloudflare Worker)** workflow. One-time setup
(full detail in `bridge/README.md`):

1. Cloudflare account → copy **Account ID**; create an API token with
   **Edit Cloudflare Workers**.
2. GitHub repo → Settings → Secrets and variables → Actions → **Secrets**:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SPOTIFY_CLIENT_ID`,
   `SPOTIFY_CLIENT_SECRET`.
3. Run that workflow once. The deploy log prints
   `https://wave-bridge.<your-subdomain>.workers.dev`.
4. Variables tab → `NEXT_PUBLIC_SPOTIFY_BRIDGE_URL` = that URL (no slash).
5. Re-run **Android APK**.

Verify: `https://wave-bridge.<subdomain>.workers.dev/api/spotify/status`
must answer `{"configured":true,"clientId":"…"}`.

## Step 3 — Build, install, sign in

1. Wait for the green Android APK run → install **on top of** the current app.
2. Wave → Search → the **Spotify** tab: search anything; playlists appear as
   cards too; open one — every track lands on official YouTube audio.
3. Empty query on the Spotify tab (or Home) → **Connect Spotify** → the
   system browser opens → sign in with the allow-listed account → back in the
   app automatically. Your top artists, top tracks, saved songs and playlists
   then fill the Spotify tab and the Home feed.
4. Log out any time from the account row in the Spotify tab.

## Quota reality (Nov 2024 Spotify API changes)

Development Mode apps: `/recommendations` and related-artists answer **403**,
`preview_url` is null. Wave is built for this:

- **Picks** fall back to popularity-ranked Spotify search from the same seeds;
- **Fans also like** hides;
- **Your library** (top artists / top tracks / saved / playlists) uses
  endpoints that DO work in dev mode — no quota needed;
- requesting **Extended Quota Mode** upgrades picks + related to the real
  engines with zero code changes.

## If "Couldn't reach Spotify" appears

- The status call works (the tab exists) but a heavier call failed.
- First search after a deploy/cold start is the slow one — try again once;
  warm results cache for 10 minutes.
- Matching happens ON DEVICE, so bridge calls are fast metadata-only reads —
  if errors persist, check the Worker logs (Cloudflare dashboard → Workers →
  wave-bridge → Logs) and that the repo secrets are still valid.

## Files

| Path | Role |
| --- | --- |
| `bridge/src/index.ts` | the Worker bridge (deployed automatically) |
| `src/app/api/spotify/*` | same endpoints as dev routes for the web runtime |
| `src/lib/spotify/match.ts` | on-device Spotify → YouTube matcher (official uploads only) |
| `src/lib/spotify/bridge.ts` | bridge calls + hit → Track conversion |
| `src/lib/spotify/userAuth.ts` | PKCE login (system browser + deep link back) |
| `src/lib/spotify/user.ts` | your library: top artists/tracks, saved, playlists |
| `src/lib/spotify/config.ts` | bridge origin (web same-origin / APK build-time constant) |
| `src/components/screens/Search.tsx` | Spotify tab: results, playlists, your library |
| `src/components/screens/Home.tsx` | Home feed shelves from your library |
| `scripts/test_spotify_match.ts` | matcher tests — `bun run scripts/test_spotify_match.ts` |
| `scripts/test_spotify_pkce.ts` | PKCE tests — `bun run scripts/test_spotify_pkce.ts` |
