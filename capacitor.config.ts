import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wave — Android APK shell.
 *
 * webDir "out" is the static SPA bundle produced by `bun run build:apk`
 * (scripts/build-apk-web.mjs → NEXT_EXPORT=1 next build). The app has no
 * bundled backend: src/lib/api.ts detects the native shell and runs the
 * YouTube (Echo) chain in-process through CapacitorHttp — native HTTP,
 * zero CORS — while the <audio> element streams googlevideo URLs that the
 * device itself minted (same IP → no proxy needed).
 */
const config: CapacitorConfig = {
  appId: "com.deeraj.wave",
  appName: "Wave",
  webDir: "out",
  server: {
    // serve the bundle from https://localhost inside the WebView (secure-context
    // APIs — localStorage, crypto.subtle, MediaSession — all available)
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
    // Android 15 (targetSdk 35) enforces edge-to-edge: without this the WebView
    // draws UNDER the status bar — the Wave wordmark collided with the clock.
    // "force" insets the WebView below the system bars on every device.
    adjustMarginsForEdgeToEdge: "force",
  },
  plugins: {
    // Route every window.fetch through the native HTTP stack: no CORS preflights
    // against music.youtube.com / googlevideo, custom User-Agent headers allowed,
    // exactly the same request surface the Node server had.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
