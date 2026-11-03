/**
 * Background-playback bridge (APK only).
 *
 * Capacitor never pauses the WebView itself, but once the activity is backgrounded
 * the PROCESS becomes cached and Android freezes/kills it — the WebView's audio dies
 * within seconds. The native side hosts a foreground mediaPlayback service that
 * keeps the process alive (plus a partial wake lock so CPU/network survive the
 * screen going off); we tell it when audible playback starts and stops.
 *
 * Web builds: every call is a no-op — a plain browser needs no native service.
 */
export function notifyPlayState(playing: boolean): void {
  if (typeof window === "undefined") return;
  const cap = (
    window as unknown as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        Plugins?: Record<string, { start?: () => unknown; stop?: () => unknown }>;
      };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const plugin = cap.Plugins?.WaveAudio;
  if (!plugin) return;
  try {
    const fn = playing ? plugin.start : plugin.stop;
    fn?.call(plugin);
  } catch {
    /* the background service is an enhancement — never break playback over it */
  }
}
