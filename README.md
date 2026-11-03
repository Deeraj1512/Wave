# Wave

A personal music app — search, play and discover Indian music across every
language. Originals only. Free forever.

Wave streams from YouTube Music's public InnerTube backend using the measured
client-chain strategy ported from Echo Music (VISIONOS → ANDROID_VR → TVHTML5,
range-probed URLs, per-video client exclusion, playable-sibling fallback).
Search results pass an originals-only filter (junk remixes / lofi / mashups
dropped), and autoplay radio fills the queue from the seeded RDAMVM Mix.

## One codebase, two runtimes

| Runtime | Search / radio / art | Audio |
| --- | --- | --- |
| **Web** (`next dev` / self-hosted) | `/api/*` routes running the Echo chain server-side | `/api/audio/*` proxy (stream URLs are IP-bound to the server) |
| **Android APK** (Capacitor) | the same chain **in-process** (`src/lib/yt/*` is isomorphic) | device-minted googlevideo URLs played directly by `<audio>` — no proxy |

The swap point is `src/lib/api.ts` (`IS_NATIVE`); `CapacitorHttp` routes
in-app `fetch`es through native HTTP so CORS never applies inside the APK.

## Develop (web)

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint
npx tsc --noEmit
```

## Build the Android APK

Requirements: Node 20+, Bun, JDK 21, Android SDK (API 35).

```bash
bun run build:apk    # static SPA export → ./out + cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

No local toolchain? Push to `main` — **GitHub Actions builds the APK on every
push** (`.github/workflows/android.yml`) and uploads it as the `wave-apk`
artifact (Actions tab → latest run → Artifacts).

## Notes

- `bun run build:standalone` produces the self-hosting bundle (Docker/VPS).
  Platform hosts (Vercel/Netlify) should use the default `next build`.
- Optional `.env` `COOKIE` (server only): a YTM cookie that reduces bot-gating
  on datacenter IPs. The APK needs no server configuration at all.
