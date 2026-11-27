BATCH 13 - Spotify-first: playlists, YOUR library (login), home feed
=====================================================================
Wave now runs Spotify as the catalog for search (tracks / artists /
albums / PLAYLISTS), your own library (playlists / saved songs / top
artists via an in-app Spotify login) and the home feed - audio still
streams from YouTube, matched to OFFICIAL uploads only, through the
existing player / queue / lockscreen pipeline.

UPLOAD EACH FILE TO THE EXACT PATH IN YOUR REPO (Deeraj1512/Wave, main):

  1. SPOTIFY-SETUP.md                        (root) - rewritten go-live guide
  2. android/app/src/main/AndroidManifest.xml       - adds the login deep-link
     scheme com.deeraj.wave://callback (REQUIRED for sign-in)
  3. bridge/README.md                        - endpoint table + dashboard steps
  4. bridge/src/index.ts                     - Worker: playlists in search, new
     /playlist endpoint, status now returns the PUBLIC clientId
  5. bun.lock  +  6. package.json            - adds @capacitor/app +
     @capacitor/browser (login plugins; cap sync picks them up at build)
  7. scripts/test_spotify_match.ts           - now targets the ACTIVE matcher
  8. scripts/test_spotify_pkce.ts            - NEW PKCE tests (RFC 7636 vector)
  9-13. src/app/api/spotify/{picks,playlist,related,search,status}/route.ts
     - dev-runtime routes: playlist endpoint added, maxDuration=60 on the
     heavy ones (the "Couldn't reach Spotify" timeout), status returns clientId
  14. src/app/callback/page.tsx              - NEW: web-runtime login callback
  15. src/components/screens/Home.tsx        - home feed shelves from YOUR
     Spotify library + connect card
  16. src/components/screens/Search.tsx      - Spotify tab: playlists section +
     in-tab playlist page + account card + your library shelves
  17-20. src/lib/spotify/{bridge,match,types}.ts - matcher hardening
     (containment guard kills interview/podcast false matches), playlist +
     client-id plumbing
  21. src/lib/spotify/user.ts                - NEW: your library endpoints
  22. src/lib/spotify/userAuth.ts            - NEW: PKCE login (no secret)
  23. .github/workflows/deploy-bridge.yml    - byte-verified trigger

BEFORE REBUILDING, ADD THE LOGIN REDIRECT URI (one dashboard edit):
  developer.spotify.com/dashboard -> Wave -> Settings -> Redirect URIs ->
  add  com.deeraj.wave://callback  (exact, no trailing slash) -> Save.
  Then User Management (same page, left sidebar) -> add the email of the
  Spotify account you will log in with. Dev mode is allow-list only -
  without this the login will fail.

THEN:
  - pushing batch 13 auto-redeploys the Worker (bridge/** changed) and
    rebuilds the APK; install the new APK on top of the current one.
  - Verify the bridge:  https://wave-bridge.<subdomain>.workers.dev/api/spotify/status
    -> {"configured":true,"clientId":"..."}.
  - In Wave: search on the Spotify tab (playlists now appear); open the empty
    Spotify tab or Home -> "Connect Spotify" -> system browser sign-in ->
    your top artists / top tracks / saved songs / playlists fill the tab and
    the home feed. Log out from the account row any time.

AUDIO RULES (unchanged): every Spotify track is matched on-device to an
official YouTube upload (ATV / official audio preferred, covers - nightcore -
1-hour loops rejected); unmatched tracks render dimmed rather than playing
something wrong. No audio ever streams from Spotify.

SHA256 (verify after zip extraction):
  51db3e23d625e53a59ac205063ebc9e38bb8fd8806baa47a1ee7ae923c49f8b0  SPOTIFY-SETUP.md
  dadf47b659e094178cc92433d68e9d100f3f4df4ae50453d9720dff1733ff572  android/app/src/main/AndroidManifest.xml
  e125a77af57237cb5aad2c587281b7c8330150a786110d6c193f32788ff5e25c  bridge/README.md
  8724cb674dfcd272dd503225a63b8f41a0a19fa3f3e62b8c5132532aee3b8282  bridge/src/index.ts
  b60bc75c2f303f6094d71e2378d2c7feb8ea84d529595902135398acb26e95b6  bun.lock
  a5edf00194ab66029069de1a1575be7431613abfae9351d84d5f7b8b66d8f3bf  package.json
  4637cb52408f3795422c1cbaf5a312e28be8fd6544151231fd6204b57d01ac44  scripts/test_spotify_match.ts
  f1c6d642bd30ca4f96c87c0925dc7532a072981c1b14bbcab4acb94a20cf16e6  scripts/test_spotify_pkce.ts
  43e5b5161ac5dbf90165eb3123cab5eab6cdbd09a211b2425e9aadba5c447fe6  src/app/api/spotify/picks/route.ts
  39ceaa8decea9064f3b1ad3b6b252a0d5a7d65af0ad06a5f086b86bf049c15c0  src/app/api/spotify/playlist/route.ts
  1a0a1507b0389c64b1039d2aa2bac76ae3a95160c0945deb0771454998881a90  src/app/api/spotify/related/route.ts
  bd6b54ac43ea2101f564f111c90206d4dc16deeded857e5173b9011df26d3716  src/app/api/spotify/search/route.ts
  915b3b90b9c8f1a5cdd9b90547bad9e3da8550d3ec4c52704059656d7d86997f  src/app/api/spotify/status/route.ts
  090541d20b20e533934e548e568a72ac8c0b2d7e4495be1cee8c459c4ae9851e  src/app/callback/page.tsx
  abd592d2c21f6144fc8eeed2f02b0f5a575efa0f43bf786c36f8ecb9ca847137  src/components/screens/Home.tsx
  5ba505460a3a3c4f66f6677d92c3a7d6bb6260a01690cc746fdae0965ea7aa08  src/components/screens/Search.tsx
  6cc20faae6f739489884edad513301f4658e244349fd98cdd888d33f6b1257c3  src/lib/spotify/bridge.ts
  61eb02584811b2d1c34a6642c24e07a54ff7b73f8515e049d81e2e6862df3884  src/lib/spotify/match.ts
  e850a57a00f83d15a05518c6cae57e067aed4194ae0860a6fcb46ec32c79cffe  src/lib/spotify/types.ts
  b4d04c1be450b4db8cf081920460888f3aa890ffb49de4b80fa2b3393f192748  src/lib/spotify/user.ts
  da0a9c748b624c313a389f7e823c6c73bb0cd7cc63f59b67220cfd9648f66943  src/lib/spotify/userAuth.ts
  81e6101e56ad0ffc25dc31ca4f907adbc74376d5006bfe815364b81e4a664177  .github/workflows/deploy-bridge.yml
