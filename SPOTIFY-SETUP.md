# Wave × Spotify — setup (Phase 1 + Phase 3)

Wave keeps playing **YouTube audio** through its existing Echo chain / IFrame
engine. Spotify adds **catalog quality**: real studio metadata, proper artist
and album artwork (300 px cards / 640 px detail pages), search that understands
official releases, and (when Spotify grants it) recommendations. The app never
plays "from Spotify" — every Spotify track is matched to a YouTube videoId by
the server-side matcher before it reaches the player.

```
Wave APK (WebView + MediaPlaybackService)
   │  HTTPS (CapacitorHttp — no CORS)
   ▼
/api/spotify/*  on the deployed Wave site (this same repo, Next.js API routes)
   ├─ /status      availability probe (hides all Spotify UI when unconfigured)
   ├─ /search      track + artist + album search → tracks pre-matched to videoIds
   ├─ /picks       recommendations seeded by listening history
   │               (falls back to popularity-ranked search while quota-gated)
   ├─ /related     "fans also like" (hidden while quota-gated)
   └─ SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET live in the server env ONLY
```

The client secret never enters the repo or the APK — the APK bakes in only the
bridge's public URL.

## Step 1 — Spotify app in the Developer Dashboard

1. https://developer.spotify.com/dashboard → **Create app**.
2. **Which API/SDKs are you planning to use?** tick **Web API** (IFrame/Android
   playback is Wave's own — untick everything else; do NOT tick Web Playback SDK).
3. **Redirect URIs** — the dashboard makes you save at least one even though
   Client Credentials never redirects. Add:
   - `http://127.0.0.1:3000/callback`  (formality for now; `localhost` is rejected, use 127.0.0.1)
   - optional, for a future in-app Spotify login: `com.deeraj.wave://callback`
4. APIs used: **Web API**. Save.
5. Copy the **Client ID** and reveal the **Client Secret** — you will paste
   these into the hosting dashboard in step 2, nowhere else.

## Step 2 — Deploy the bridge from THIS GitHub repo (Vercel, free)

The API routes already live in this repo (`src/app/api/spotify/*`). Vercel's
free Hobby tier imports a GitHub repo directly — no config file, no Netlify,
no extra repository needed.

1. https://vercel.com → sign up / log in **with GitHub**.
2. **Add New… → Project** → import **Deeraj1512/Wave**.
3. Framework Preset auto-detects **Next.js**. Leave build settings untouched.
4. **Environment Variables** — add both:
   - `SPOTIFY_CLIENT_ID`  = your client id
   - `SPOTIFY_CLIENT_SECRET` = your client secret
5. **Deploy**. You get a URL like `https://wave-xxxx.vercel.app`.
6. Verify in a browser: `https://wave-xxxx.vercel.app/api/spotify/status`
   → `{"configured":true}`. If it says `configured:false`, re-check step 4.

(Any Node host works the same way — the routes are plain Next.js handlers —
but Vercel is the one-click path straight from this GitHub repo.)

## Step 3 — Tell the APK where the bridge lives

GitHub repo → **Settings → Secrets and variables → Actions → Variables tab →
New repository variable**:

- Name: `NEXT_PUBLIC_SPOTIFY_BRIDGE_URL`
- Value: `https://wave-xxxx.vercel.app`  (no trailing slash)

`.github/workflows/android.yml` passes this variable into `bun run build:apk`;
`next build` inlines it into the static export and `src/lib/spotify/config.ts`
reads it inside the APK. Until the variable is set, the APK builds fine but the
Spotify tab stays hidden — Wave keeps working as a pure YTM app.

## Step 4 — Build and verify

1. Push (or re-run the last **Android APK** workflow). Install the new APK
   **on top of** the old one — the signing key is permanent, no uninstall.
2. In Wave: search anything → the **Spotify** tab now appears next to
   Songs/Albums.
3. Spotify results: matched songs play through the normal player, queue,
   radio and lock-screen controls; artist chips open the existing per-artist
   page; album cards open the existing album page; unmatchable tracks show
   dimmed with "no YouTube match" instead of failing silently.
4. Empty search box + Spotify tab → **Spotify picks** (seeded by your listening
   history and taste languages) and, when Spotify allows it, **fans also like**.

## Quota reality (Nov 2024 Spotify API changes)

Apps in Development Mode (default) get `/v1/recommendations` and
`/v1/artists/:id/related-artists` **403** — and `preview_url` is null.

- Wave is built for this: picks fall back to popularity-ranked Spotify search
  from the same seeds; the related-artists row simply hides.
- To unlock the real recommendation engine, request **Extended Quota Mode**
  (Dashboard → your app →Extensions) — when granted, both features start
  working with zero code changes.

## Files

| Path | Role |
| --- | --- |
| `src/app/api/spotify/{status,search,picks,related}/route.ts` | the bridge (server-only) |
| `src/lib/spotify/serverAuth.ts` | Client Credentials token mint + cache + gating detection |
| `src/lib/spotify/serverMatch.ts` | Spotify track → YouTube videoId matcher (scoring, tiers, caches) |
| `src/lib/spotify/serverResolve.ts` | artist name → Spotify id, genre-seed validation |
| `src/lib/spotify/bridge.ts` | client calls + Spotify hit → Wave Track conversion |
| `src/lib/spotify/config.ts` | bridge origin: web same-origin / APK build-time constant |
| `src/components/screens/Search.tsx` | Spotify tab + picks panel (UI) |
| `scripts/test_spotify_match.ts` | offline matcher tests — `bun run scripts/test_spotify_match.ts` |
