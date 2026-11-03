/**
 * Background-playback bridge (APK only).
 *
 * Capacitor never pauses the WebView itself, but once the activity is backgrounded
 * the PROCESS becomes cached and Android freezes/kills it — the WebView's audio dies
 * within seconds. The native side hosts a foreground mediaPlayback service that
 * keeps the process alive (a partial wake lock runs only while actually playing so
 * CPU/network survive the screen going off); the same service renders Wave's
 * notification / lock-screen card — MediaStyle with prev / play-pause / next bound
 * to a real MediaSession. Every card button is routed back into the web player via
 * window.__waveMediaAction (registered in player.tsx), so the HTML5 audio element
 * stays the single source of playback truth.
 *
 * Web builds: every call is a no-op — a plain browser needs no native service
 * (its card comes from the MediaSession API in mediaSession.ts instead).
 */

export interface NativeMediaMeta {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  playing: boolean;
}

type WaveAudioPlugin = {
  start?: () => unknown;
  stop?: () => unknown;
  update?: (meta: NativeMediaMeta) => unknown;
  requestNotificationPermission?: () => unknown;
};

type CapShape = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, WaveAudioPlugin | undefined>;
};

let serviceStarted = false;
let permissionAsked = false;
let lastMeta: NativeMediaMeta | null = null;

function cap(): CapShape | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapShape }).Capacitor;
}

function plugin(): WaveAudioPlugin | undefined {
  const c = cap();
  return c?.isNativePlatform?.() ? c.Plugins?.WaveAudio : undefined;
}

/**
 * Audible state flipped (audio element + engine paths both call this). Playing →
 * ensure the service/card exist (and ask for the Android 13+ notification
 * permission once); paused → keep the card with a ▶ button (YTM behavior) but
 * let go of the wake lock natively.
 */
export function notifyPlayState(playing: boolean): void {
  const p = plugin();
  if (!p) return;
  try {
    if (playing) {
      p.start?.();
      if (!permissionAsked) {
        permissionAsked = true;
        try {
          p.requestNotificationPermission?.();
        } catch {
          /* the dialog is best-effort */
        }
      }
      serviceStarted = true;
    } else if (serviceStarted) {
      p.update?.({
        title: lastMeta?.title ?? "Wave",
        artist: lastMeta?.artist ?? "",
        album: lastMeta?.album,
        cover: lastMeta?.cover,
        playing: false,
      });
    }
  } catch {
    /* the background service is an enhancement — never break playback over it */
  }
}

/**
 * Push card content (track change, pause, play) or tear the card down (null =
 * queue emptied → service stops, notification dismissed).
 */
export function notifyNativeMedia(meta: NativeMediaMeta | null): void {
  const p = plugin();
  if (!p) return;
  try {
    if (!meta) {
      if (serviceStarted) {
        p.stop?.();
        serviceStarted = false;
      }
      lastMeta = null;
      return;
    }
    lastMeta = meta;
    if (!serviceStarted) {
      if (!meta.playing) return; // never spawn the service for a paused push
      p.start?.();
      if (!permissionAsked) {
        permissionAsked = true;
        try {
          p.requestNotificationPermission?.();
        } catch {
          /* best-effort */
        }
      }
      serviceStarted = true;
    }
    p.update?.(meta);
  } catch {
    /* the background service is an enhancement — never break playback over it */
  }
}
