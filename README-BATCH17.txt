BATCH 17 — "Couldn't reach Spotify" ROOT CAUSE + FIX (read this first)
======================================================================

WHAT WAS ACTUALLY WRONG (proved against your live bridge)
---------------------------------------------------------
Your APK v71 asks https://wave-sable-eight.vercel.app/api/spotify/*. I
called that bridge directly:

  /api/spotify/status  -> {"configured":true,"clientId":"1c1e..."}  OK
                          (slow first call: ~11 s cold start)
  /api/spotify/search  -> "spotify 403 for /search?q=veera&...&limit=20"
                          -> the route passed it to the app as a 502
                          -> the app showed "Couldn't reach Spotify"

So the tab, credentials and login plumbing are all fine — SPOTIFY refuses
the search call itself. Two causes, one code, one account:

1) CODE (fixed here): Spotify caps /search at 10 results per request since
   February 2026 and REJECTS anything larger. The bridge asked for 20.
   -> The search route now caps every request at 10.

2) ACCOUNT (needs one check on your side): since 9 March 2026 Spotify's
   Development Mode requires the owning account to be PREMIUM, allows max
   5 allow-listed users, and one dev-mode client per developer. A Free
   account gets 403 on catalog calls even with a perfectly valid token.

SELF-DIAGNOSING FROM NOW ON
---------------------------
The bridge used to swallow Spotify's error body; the app only ever saw a
bare status code. Batch17 pipes Spotify's own reason (e.g. "You need a
Premium account…", "User not registered in the Developer Dashboard",
rate-limit text) all the way into the red error panel on the Spotify tab.
So after this update, IF anything still fails, the app will tell you the
exact reason — no more guessing.

ALSO FIXED WHILE AUDITING
-------------------------
- Every app-side bridge fetch now has a 30 s hard timeout (a cold serverless
  call could hang the tab forever before).
- A failed availability probe used to stick for 10 minutes; now it retries
  within 60 s, so fixes on your side show up in the app within a minute.
- .github/workflows/deploy-bridge.yml trigger was double-checked and is
  intact (branches: [main]) — earlier suspicion was a false alarm, no
  change needed there.
- SPOTIFY-SETUP.md now documents the 2026 policy (Premium, 5 users, search
  cap) and a proper troubleshooting section.

WHAT YOU DO (5 minutes)
-----------------------
1. Upload the 5 files below to the same paths in Deeraj1512/Wave (main).
   - The push auto-redeploys the Vercel backend (search route fixed there).
2. Re-run the "Android APK" workflow -> install the new APK (v72) on top.
3. Try a search on the Spotify tab.
4. If it STILL shows "Spotify refused the request … 403 …":
   a. developer.spotify.com/dashboard -> Wave -> User Management:
      make sure YOUR Spotify account email is added.
   b. That account must be Premium (Spotify's 2026 rule for Development
      Mode). Upgrade it, wait ~1 minute, retry in-app — no rebuild needed.
5. Sanity check in any browser:
   https://wave-sable-eight.vercel.app/api/spotify/search?q=veera
   -> JSON with tracks = all good; a JSON "error": "…403 …" line now names
      the exact remaining problem.

VERIFY THE PACKAGE (already done before zipping)
------------------------------------------------
- matcher tests: 11 passed, 0 failed
- PKCE tests: 6 passed, 0 failed
- npx next build: green, all /api/spotify routes registered
- build-apk-web export: green

UPLOAD LIST (same paths in the repo, main branch)
--------------------------------------------------
src/lib/spotify/serverAuth.ts
src/app/api/spotify/search/route.ts
src/lib/spotify/bridge.ts
src/components/screens/Search.tsx
SPOTIFY-SETUP.md

Nothing to delete this time. No dashboard, secret or variable changes.
