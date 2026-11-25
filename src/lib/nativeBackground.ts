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
  /** Track length in SECONDS — the card's seek bar total. Android hides the
   *  bar entirely while it is 0/absent, so it must ride along once per track. */
  duration?: number;
  /** Current playback position in SECONDS. Android extrapolates the bar between
   *  pushes (speed 1.0), so one push per play/pause/seek/track-change is enough. */
  position?: number;
  /** Lock-screen shuffle button state (true = on). */
  shuffle?: boolean;
  /** Lock-screen loop button state: 0 = off · 1 = loop all · 2 = loop one. */
  repeat?: number;
}

type WaveAudioPlugin = {
  start?: () => unknown;
  stop?: () => unknown;
  update?: (meta: NativeMediaMeta) => unknown;
  requestNotificationPermission?: () => unknown;
  getNativeState?: () => Promise<{ running?: boolean; playing?: boolean }>;
};

type CapShape = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, WaveAudioPlugin | undefined>;
};

let serviceStarted = false;
let permissionAsked = false;
let lastMeta: NativeMediaMeta | null = null;
// Latest lock-screen mode-button state + audible flag — EVERY update payload
// carries them, so the native card's shuffle/loop buttons can never drift away
// from what the in-app UI shows.
let modes = { shuffle: false, repeat: 0 };
let lastPlaying = false;

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
export function notifyPlayState(
  playing: boolean,
  snap?: { position?: number; duration?: number }
): void {
  const p = plugin();
  if (!p) return;
  lastPlaying = playing;
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
      // Ride the exact resume point along — the card's bar starts from truth
      // instead of the service's last (possibly stale) extrapolation.
      p.update?.({
        title: lastMeta?.title ?? "Wave",
        artist: lastMeta?.artist ?? "",
        album: lastMeta?.album,
        cover: lastMeta?.cover,
        playing: true,
        shuffle: modes.shuffle,
        repeat: modes.repeat,
        position: snap?.position,
        duration: snap?.duration,
      });
    } else if (serviceStarted) {
      p.update?.({
        title: lastMeta?.title ?? "Wave",
        artist: lastMeta?.artist ?? "",
        album: lastMeta?.album,
        cover: lastMeta?.cover,
        playing: false,
        shuffle: modes.shuffle,
        repeat: modes.repeat,
        position: snap?.position,
        duration: snap?.duration ?? lastMeta?.duration,
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
    if (meta.playing) lastPlaying = true;
    if (meta.shuffle !== undefined) modes.shuffle = meta.shuffle;
    if (meta.repeat !== undefined) modes.repeat = meta.repeat;
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
    p.update?.({
      ...meta,
      shuffle: meta.shuffle ?? modes.shuffle,
      repeat: meta.repeat ?? modes.repeat,
    });
  } catch {
    /* the background service is an enhancement — never break playback over it */
  }
}

/**
 * The one honest answer to "is music actually playing right now?", read from the
 * native service (APK only). A page reload asks this to tell a pull-to-refresh
 * apart (service alive → keep playing) from a fresh open after a kill (service
 * dead → restore the queue PAUSED at the saved position). Returns null on web
 * builds (no plugin) — callers fall back to their pre-native behavior.
 */
export async function getNativePlaybackState(): Promise<
  { running: boolean; playing: boolean } | null
> {
  const p = plugin();
  if (!p || typeof p.getNativeState !== "function") return null;
  try {
    const st = await p.getNativeState();
    if (!st || typeof st !== "object") return null;
    return { running: !!st.running, playing: !!st.playing };
  } catch {
    return null;
  }
}

/**
 * Slow-cadence position resync from the player's ~1Hz progress tick (call it
 * every ~10s, not every tick — each call is an IPC round-trip into the
 * service). Keeps the card's bar glued to reality through buffering stalls
 * and long-play drift; Android extrapolates the seconds in between itself.
 */
export function notifyNativeProgress(position: number, duration: number): void {
  const p = plugin();
  if (!p || !serviceStarted || !lastMeta) return;
  try {
    p.update?.({
      title: lastMeta.title,
      artist: lastMeta.artist,
      album: lastMeta.album,
      cover: lastMeta.cover,
      playing: lastMeta.playing,
      shuffle: modes.shuffle,
      repeat: modes.repeat,
      position,
      duration: duration > 0 ? duration : undefined,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Push the lock-screen mode buttons (shuffle on/off, loop off/all/one) after an
 * in-app toggle. Deliberately sends NO position/duration — the card's seek bar
 * keeps its own extrapolation and must not rewind. While no card exists yet the
 * state is only remembered: it rides along on every later update push instead.
 */
export function notifyNativeModes(shuffle: boolean, repeat: number): void {
  modes = { shuffle, repeat };
  const p = plugin();
  if (!p || !serviceStarted || !lastMeta) return;
  try {
    p.update?.({
      title: lastMeta.title,
      artist: lastMeta.artist,
      album: lastMeta.album,
      cover: lastMeta.cover,
      playing: lastPlaying,
      shuffle,
      repeat,
    });
  } catch {
    /* best-effort */
  }
}
