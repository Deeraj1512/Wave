/**
 * OS media session — Wave's own lock-screen / notification card.
 *
 * Why this exists: with no session declared, Chrome auto-derives the media
 * notification from whatever plays — and for the embed engine that is the hidden
 * YouTube iframe's OWN session: raw uploader string ("Devi Sri Prasad - Topic"),
 * play/pause only, no previous/next/seek. That is exactly what the mobile
 * screenshots showed: a card Wave doesn't control, missing its transport buttons.
 *
 * Declaring the session from the top document gives Wave:
 *   - clean metadata (catalog artist with " - Topic" stripped, our artwork)
 *   - YTM-style transport controls: prev / next / ±10s / seek-to / stop
 *   - a live position state so the notification scrubber tracks playback
 *
 * Handlers are registered once at player mount (closures over refs — always
 * current); metadata, playback state and position are pushed reactively from
 * PlayerProvider effects. Every call is guarded + try/caught — a missing or
 * grumpy MediaSession implementation must never break playback itself.
 */

const VIDEO_ID_RE = /^[\w-]{11}$/;
/** "Devi Sri Prasad - Topic" → "Devi Sri Prasad" (same cleanup as search/radio/api) */
const TOPIC_RE = /\s*-\s*Topic\s*$/i;

export interface MediaSessionHandlers {
  /** resume playback (fires only while paused) */
  play(): void;
  /** halt playback (fires only while playing) */
  pause(): void;
  next(): void;
  prev(): void;
  /** absolute seek from the notification scrubber / voice ("play chorus") */
  seek(sec: number): void;
  /** engine-aware current position in seconds */
  position(): number;
  /** engine-aware duration in seconds (0 = unknown) */
  duration(): number;
}

export interface MediaTrackMeta {
  title: string;
  artist: string;
  album?: string;
  movie?: string;
  cover?: string;
  id?: string;
}

let handlers: MediaSessionHandlers | null = null;
let lastPositionPush = 0;
let lastMeta: MediaTrackMeta | null = null;

function supported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

function setHandler(action: MediaSessionAction, cb: ((d?: MediaSessionActionDetails) => void) | null) {
  try {
    navigator.mediaSession.setActionHandler(action, cb);
  } catch {
    /* action unsupported on this browser — the button simply won't render */
  }
}

/**
 * Register all transport handlers. Chrome only SHOWS the buttons whose handlers
 * exist — previoustrack/nexttrack is precisely what the screenshots were missing.
 */
export function initMediaSession(h: MediaSessionHandlers): void {
  if (!supported()) return;
  handlers = h;
  setHandler("play", () => h.play());
  setHandler("pause", () => h.pause());
  setHandler("previoustrack", () => h.prev());
  setHandler("nexttrack", () => h.next());
  setHandler("stop", () => h.pause());
  setHandler("seekbackward", (d) => {
    const back = (d as (MediaSessionActionDetails & { seekOffset?: number }) | undefined)?.seekOffset ?? 10;
    h.seek(Math.max(0, h.position() - back));
    pushPositionState(h.position(), h.duration(), true);
  });
  setHandler("seekforward", (d) => {
    const fwd = (d as (MediaSessionActionDetails & { seekOffset?: number }) | undefined)?.seekOffset ?? 10;
    const dur = h.duration();
    h.seek(Math.min(dur > 0 ? dur - 0.5 : Number.MAX_SAFE_INTEGER, h.position() + fwd));
    pushPositionState(h.position(), h.duration(), true);
  });
  setHandler("seekto", (d) => {
    const t = (d as (MediaSessionActionDetails & { seekTime?: number }) | undefined)?.seekTime;
    if (typeof t === "number" && Number.isFinite(t)) {
      h.seek(t);
      pushPositionState(h.position(), h.duration(), true);
    }
  });
}

/** Push the current track into the OS card. `null` clears it (queue emptied). */
export function syncTrackMetadata(t: MediaTrackMeta | null): void {
  lastMeta = t;
  if (!supported()) return;
  try {
    if (!t) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artist = t.artist.replace(TOPIC_RE, "").trim() || t.artist;
    const album = (t.album ?? "").trim() || t.movie || undefined;
    const art = t.cover?.trim() || (t.id && VIDEO_ID_RE.test(t.id) ? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg` : undefined);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist,
      ...(album ? { album } : {}),
      ...(art ? { artwork: [{ src: art, type: "image/jpeg" }] } : {}),
    });
  } catch {
    /* metadata is cosmetic — never let it throw into the player */
  }
}

/** Mirror isPlaying into the notification (wrong state = dead ⏸/▶ button). */
export function setPlaybackState(state: "playing" | "paused" | "none"): void {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {}
}

/**
 * Keep the notification scrubber in sync. Chrome extrapolates from the last push
 * at `playbackRate`, so ~1Hz is plenty while playing; pass force=true on
 * play/pause/seek so the bar snaps to truth immediately.
 */
export function pushPositionState(position: number, duration: number, force = false): void {
  if (!supported() || !("setPositionState" in navigator.mediaSession)) return;
  const now = Date.now();
  if (!force && now - lastPositionPush < 900) return;
  if (!(duration > 0) || !(position >= 0) || position > duration) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position, playbackRate: 1 });
    lastPositionPush = now;
  } catch {
    /* invalid transient state (mid-seek, duration swap) — next tick fixes it */
  }
}

/** Metadata pushed while the session is still inactive can be dropped by some
 *  builds — re-push the last known track the moment playback goes live. */
export function reassertMetadata(): void {
  if (lastMeta) syncTrackMetadata(lastMeta);
}

// ── silent anchor audio ────────────────────────────────────────────────────────
// The OS only shows Wave's card for a media session that has an AUDIBLE element
// of its own. The embed engine's sound lives inside the cross-origin YouTube
// iframe — its playback belongs to YouTube's session, and many mobile browsers
// never surface a cross-origin iframe's card at all. The sim engine has no media
// element whatsoever. Metadata declared while nothing plays in the top document
// is ignored. So the top document needs a real, PLAYING <audio> to make Wave's
// session — our metadata, prev/next, scrubber — the card the OS shows.
//
// A looped WAV of pure digital silence is exactly that: inaudible at any gain,
// but "playing, unmuted, volume > 0" — Chrome's audibility heuristic — so the
// tab keeps background playback and Wave's session holds the lock-screen card.

let anchorEl: HTMLAudioElement | null = null;

/** 8 kHz 8-bit mono PCM WAV of digital silence (128 = mid-scale), blob URL. */
function silentWavUrl(seconds = 2, sampleRate = 8000): string {
  const samples = seconds * sampleRate;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true); // byte rate (1 byte / sample)
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits per sample
  tag(36, "data");
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/**
 * Create (once) + start the anchor. Call from USER-GESTURE playback paths
 * (track tap, play/pause) while the tap's activation is still fresh; later
 * calls are idempotent and any failure is swallowed — playback itself must
 * never depend on the anchor.
 */
export function ensureAnchorAudio(): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  try {
    if (!anchorEl) {
      const el = new Audio(silentWavUrl());
      el.loop = true;
      el.volume = 0.01; // >0 keeps Chrome's "audible" heuristic true; content is silence
      el.preload = "auto";
      el.setAttribute("aria-hidden", "true");
      document.head.appendChild(el); // connected but never rendered/audible
      anchorEl = el;
    }
    if (anchorEl.paused) void anchorEl.play().catch(() => {});
  } catch {
    /* cosmetic — playback never depends on the anchor */
  }
}

/** Mirror engine play/pause so the card tracks reality (the anchor is the session's heartbeat). */
export function setAnchorPlaying(playing: boolean): void {
  if (playing) ensureAnchorAudio();
  if (!anchorEl) return;
  try {
    if (playing) {
      if (anchorEl.paused) void anchorEl.play().catch(() => {});
    } else if (!anchorEl.paused) {
      anchorEl.pause();
    }
  } catch {}
}

/**
 * Re-assert the top document's audio focus: the freshest audible media wins the
 * card, and each new iframe playback lets YouTube's own session claim it again.
 * A pause→play flip (of a silent element — invisible) re-takes the card. Pulses
 * are repeated because the iframe's session may register a beat after its first
 * audio frame; every pulse no-ops while the engine is paused.
 */
export function bumpAnchorFocus(): void {
  const pulse = () => {
    if (!anchorEl || anchorEl.paused) return;
    try {
      anchorEl.pause();
      anchorEl.currentTime = 0;
      void anchorEl.play().catch(() => {});
    } catch {}
  };
  pulse();
  setTimeout(pulse, 1200);
  setTimeout(pulse, 2600);
}

/** Player teardown — drop handlers + metadata so a stale card can't linger. */
export function clearMediaSession(): void {
  if (!supported()) return;
  handlers = null;
  lastMeta = null;
  if (anchorEl && !anchorEl.paused) {
    try {
      anchorEl.pause();
    } catch {}
  }
  try {
    for (const a of ["play", "pause", "previoustrack", "nexttrack", "stop", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]) {
      setHandler(a, null);
    }
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    if ("setPositionState" in navigator.mediaSession) navigator.mediaSession.setPositionState();
  } catch {}
}
