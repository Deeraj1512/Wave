# Wave → Android APK via PWA + PWABuilder (TWA) — Option 1

Wave becomes an installable PWA on Netlify, then PWABuilder wraps the live site
into an Android package (Trusted Web Activity). **No changes to your API layer,
no static export, no Capacitor** — the app keeps running exactly as deployed.

```
APK (TWA shell)  ──just loads──▶  https://wave-musical.netlify.app
                                  (PWA: manifest + service worker + icons)
```

## Why this wins for Wave

- **UI updates need NO new APK** — the APK is a shell around your live site;
  every `git push` updates the installed app instantly.
- Search / radio / stream APIs stay same-origin — no CORS, no `NEXT_PUBLIC_API_BASE`.
- One pipeline produces both **APK** (sideload) and **AAB** (Play Store).

---

## 1. Copy these files into your repo

| File in this kit | Destination | Action |
|---|---|---|
| `src/app/manifest.ts` | `src/app/manifest.ts` | **new** (Next auto-injects the manifest link) |
| `src/components/pwa-register.tsx` | `src/components/pwa-register.tsx` | **new** (registers the service worker) |
| `src/app/layout.tsx` | `src/app/layout.tsx` | **replace** (adds `PwaRegister` + iOS web-app meta) |
| `public/sw.js` | `public/sw.js` | **new** (music-app-aware service worker) |
| `public/offline.html` | `public/offline.html` | **new** (dark offline fallback) |
| `public/icons/*.png` | `public/icons/` | **new** (4 icons, generated from your 1024px icon) |
| `netlify.toml` | `netlify.toml` | **replace** (your config + PWA cache headers) |
| `scripts/generate-icons.mjs` | `scripts/generate-icons.mjs` | optional (regenerate icons after logo changes) |

No npm installs are required. Nothing to revert in `src/lib/`.

### If you applied the earlier Capacitor kit

| File | Verdict |
|---|---|
| `next.config.ts` (mobile branch) | revert to original — the `BUILD_TARGET` branch is inert but unnecessary |
| `src/lib/api.ts` / `player.tsx` (`apiUrl`) | keep or revert — inert without `NEXT_PUBLIC_API_BASE` |
| `src/middleware.ts` (CORS) | delete — same-origin TWA never triggers CORS |
| `scripts/build-mobile.mjs`, `capacitor.config.ts` | delete — Capacitor path abandoned |
| `android/` folder | delete if created |

## 2. Deploy & verify

```bash
git add -A && git commit -m "PWA: manifest, service worker, icons" && git push
```

Netlify rebuilds. Then check all four (should be 200s / clean):

- `https://wave-musical.netlify.app/manifest.webmanifest` → JSON manifest
- `https://wave-musical.netlify.app/sw.js` → service worker script
- `https://wave-musical.netlify.app/icons/icon-512.png` → icon
- Chrome DevTools ▸ Application ▸ Manifest → "Installability: no errors"

Quick install test: Chrome on Android ▸ menu ▸ **Add to Home screen** — if that
works, packaging will work.

## 3. Build the APK with PWABuilder (no toolchain needed)

1. Go to **[pwabuilder.com](https://www.pwabuilder.com)** → paste your site URL → **Start**
2. Review the manifest/service worker scores (your kit passes all hard checks)
3. Click **Package for stores → Android**
4. Options:
   - **Package ID**: `com.deeraj.wave`
   - **App name**: `Wave`
   - **Version**: start at `1.0.0` (bump for each Play upload)
   - **Signing**: let PWABuilder *generate a new key* — it returns a `.keystore`,
     `signing-key.txt` (passwords!) and the `assetlinks.json` content. **Store
     these files safely and never commit them.**
5. Download the zip → contains **`app-release-signed.apk`** (share directly),
   `app-release-bundle.aab` (Play Store), and `assetlinks.json`

**Assetlinks (removes the URL bar in the installed app):**
copy the generated `assetlinks.json` into `public/.well-known/assetlinks.json`
in your repo → push → redeploy. The TWA then runs fullscreen as a verified app.
(Directory name must be exactly `.well-known`.)

## 3b. Alternative: Bubblewrap CLI (if you prefer local builds)

```bash
npm i -g @bubblewrap/cli        # needs JDK 17
bubblewrap init --manifest=https://wave-musical.netlify.app/manifest.webmanifest
bubblewrap build                # → app-release-signed.apk / .aab
```

## 4. Distribution

- **Direct (GitHub Releases / Drive / your site)**: share `app-release-signed.apk`.
  Users tap it → allow "install unknown apps" → done.
- **Play Store**: upload the `.aab` + store listing ($25 one-time fee).
  ⚠️ A YouTube-based music app may fail Play review (YouTube ToS); the
  sideload route is the safer distribution for Wave.

## 5. Update loop

| Change | Action needed |
|---|---|
| UI / features / backend | `git push` — live for **every installed user instantly** |
| App icon / name / package ID | edit manifest → new PWABuilder package → new APK |
| Play Store version bump | repackage AAB with version + 0.0.1 |

## Troubleshooting

| Symptom | Fix |
|---|---|
| PWABuilder "no manifest found" | open the manifest URL in a browser; make sure the deploy finished, then hard-refresh PWABuilder |
| SW not registering | DevTools ▸ Application ▸ Service Workers → check for console errors; `/sw.js` must return 200 |
| Installed app shows URL bar | `assetlinks.json` missing/incorrect SHA256 → re-drop the file from the latest PWABuilder zip and redeploy |
| Stale UI after deploy on Android | bump `VERSION` in `sw.js` (one string) and push |
| Offline page shows while online | navigation request failing server-side — check Netlify deploys, not the SW |
