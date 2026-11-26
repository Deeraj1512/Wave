BATCH 12 - Spotify Phase 1 + Phase 3 go-live wiring
====================================================
Wave already contains the full Spotify layer (search tab, matcher, picks,
related-artists, artwork 300/640px). What was missing: the APK build never
received the bridge URL, so the Spotify tab could never appear. This batch
wires it, hardens the matcher, and ships the permanent setup guide.

UPLOAD EACH FILE TO THE EXACT PATH IN YOUR REPO (Deeraj1512/Wave, branch main):

  1. .github/workflows/android.yml
       -> replaces the workflow. Now passes the repository VARIABLE
          NEXT_PUBLIC_SPOTIFY_BRIDGE_URL into the APK web build.

  2. src/lib/spotify/serverMatch.ts
       -> matcher hardening. A video whose title merely CONTAINS the song name
          (interviews, podcasts, reaction videos) no longer passes as the song;
          "- Topic" / "(Official Audio)" still match as before.

  3. scripts/test_spotify_match.ts
       -> offline matcher tests (11 cases, no network). Run locally with:
          bun run scripts/test_spotify_match.ts

  4. SPOTIFY-SETUP.md
       -> the permanent go-live guide. Follow it top to bottom.

AFTER UPLOADING, DO THESE FOUR STEPS (full details in SPOTIFY-SETUP.md):

  STEP 1  Spotify dashboard: create app, tick "Web API", Redirect URIs =
          http://127.0.0.1:3000/callback  (formality - Client Credentials never
          redirects). Copy Client ID + Client Secret.

  STEP 2  vercel.com -> log in WITH GITHUB -> import Deeraj1512/Wave -> add env
          vars SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET -> Deploy.
          (This deploys the API routes that live in THIS repo. No Netlify.)
          Verify: https://wave-xxxx.vercel.app/api/spotify/status
          must answer {"configured":true}.

  STEP 3  GitHub repo -> Settings -> Secrets and variables -> Actions ->
          Variables tab -> New repository variable:
            Name:  NEXT_PUBLIC_SPOTIFY_BRIDGE_URL
            Value: https://wave-xxxx.vercel.app      (no trailing slash)

  STEP 4  Pushing batch 12 already triggers a build - wait for the green
          "Android APK" run, download wave-v<run>.apk, install ON TOP of the
          current app (permanent signing key, no uninstall needed).
          Then in Wave: search something -> the "Spotify" tab appears.

WHAT YOU GET
  - Search -> Spotify tab: real studio metadata + 640px artwork, tracks
    pre-matched to YouTube audio (matched ones play through the normal player;
    unmatchable ones show dimmed with "no YouTube match").
  - Artist chips / album cards open the EXISTING Wave pages.
  - Empty search + Spotify tab: "Spotify picks" seeded from your listening
    history, plus "fans also like" when Spotify allows it. While the app is in
    Development Mode, picks use the built-in fallback (popularity-ranked
    search); requesting Extended Quota Mode in the dashboard upgrades both to
    the real recommendation engines with zero code changes.

SECURITY
  - The client secret lives ONLY in Vercel env vars. The repo, the workflow and
    the APK never see it - the APK bakes in the public bridge URL only.

SHA256 (verify after zip extraction):
  e64f8ff3afcdbb3b24235b6950df9082518aabe1fce375dff82388efa947ef8e  .github/workflows/android.yml
  bd505845c4190d1d3654795ef4a988f12bb6568bf1b4aee24c826ee410ff856e  src/lib/spotify/serverMatch.ts
  190d2a350ca5df01d2c1ffb818bbc771144fad4f4ae8cf26e024b1e95973faac  scripts/test_spotify_match.ts
  b198860b1a27f32bebdf943db4f820a7539d97e77337694afaa5039720dacef4  SPOTIFY-SETUP.md
