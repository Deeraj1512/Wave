/**
 * YT IFrame embed engine — the delivery fallback for bot-gated networks.
 *
 * Why this exists: googlevideo stream URLs are IP-bound to whoever called /player. From
 * datacenter IPs (like this sandbox), YouTube's /player endpoint answers
 * "Sign in to confirm you're not a bot" for EVERY client (VISIONOS, ANDROID_VR, TVHTML5,
 * WEB_REMIX) — Echo's own chain included. The direct chain still works great from residential
 * IPs (the user's home server), but here the server-side resolve can't mint URLs.
 *
 * The IFrame embed is YouTube's OFFICIAL delivery path: it runs in the USER's browser, so the
 * server's IP is irrelevant and there is no bot gate. We keep the entire Wave UI and drive a
 * hidden 1x1 iframe through the IFrame API — play/pause/seek/volume/queue all controllable.
 *
 * Engine interface (mirrors HTMLAudioElement semantics):
 *   load(videoId, autoplay) / play() / pause() / seek(s) / setVolume(0..1)
 *   getTime() / getDuration() / destroy()
 * Events (single subscriber, set by the player): onState(state), onError(code)
 */

export type YtState = "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued";

type Handlers = {
  onState?: (s: YtState) => void;
  onError?: (code: number) => void;
};

interface YtPlayerInstance {
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (sec: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
let player: YtPlayerInstance | null = null;
let creating: Promise<YtPlayerInstance> | null = null;
const stateMap: Record<number, YtState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

export let lastError: number | null = null;

function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("iframe_api failed to load"));
    document.head.appendChild(s);
    // hard timeout: if the API never arrives, let the caller fall back to sim
    setTimeout(() => reject(new Error("iframe_api timeout")), 12000);
  }).catch((e) => {
    apiPromise = null; // allow retry on next play attempt
    throw e;
  });
  return apiPromise;
}

/**
 * IMPORTANT (discovered by A/B probing): creating the player WITH a videoId in the
 * constructor (the "first video must be in the constructor" pattern) makes YouTube's
 * embed serve spurious error 150 ("embedding not allowed") for many fully-embeddable
 * videos — reproducibly, while oEmbed reports the video as embeddable and the SAME
 * video plays instantly when loaded via loadVideoById on a video-less player.
 * So: always create the player EMPTY, then drive every load (including the first)
 * through loadVideoById — verified 12/12 videos play via that path.
 */
function createPlayer(handlers: Handlers): Promise<YtPlayerInstance> {
  if (player) return Promise.resolve(player);
  if (creating) return creating;
  creating = (async () => {
    await loadApi();
    const host = document.createElement("div");
    host.id = "dhun-yt-embed";
    host.setAttribute(
      "style",
      "position:fixed;left:0;bottom:0;width:200px;height:120px;opacity:0;pointer-events:none;z-index:-1;border:0"
    );
    document.body.appendChild(host);
    const p = await new Promise<YtPlayerInstance>((resolve, reject) => {
      try {
        new window.YT.Player(host, {
          height: "120",
          width: "200",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
            enablejsapi: 1,
          },
          events: {
            onReady: (e: any) => resolve(e.target),
            onError: (e: any) => {
              const code = Number(e?.data ?? -1);
              lastError = code;
              if (typeof window !== "undefined") (window as any).__dhunYTError = code; // debug
              handlers.onError?.(code);
            },
            onStateChange: (e: any) => {
              const st = stateMap[e?.data as number] ?? "unstarted";
              if (e?.data === 0 || e?.data === 1 || e?.data === 2 || e?.data === 3) {
                handlers.onState?.(st);
              }
            },
          },
        });
      } catch (err) {
        reject(err);
      }
    });
    player = p;
    applyIframeAttributes();
    if (typeof window !== "undefined") (window as any).__dhunYT = p; // debug handle
    return p;
  })();
  return creating;
}

let handlers: Handlers = {};
let currentId: string | null = null;
let nudgeTimer: ReturnType<typeof setInterval> | null = null;
/** set when we had to fall back to muted autoplay; next user gesture restores sound */
let soundBlocked = false;
let autoRestoreInstalled = false;
/** true once the engine has been successfully used (API loaded + player created) */
export let available = false;

/** The YT API REPLACES the host div with an iframe — the div's inline style is lost, so we
 * re-apply it to the real iframe, and set the allow attribute that cross-origin audible
 * autoplay REQUIRES (without it Chrome silently blocks sound and we fall back to muted). */
const HIDDEN_STYLE =
  "position:fixed;left:0;bottom:0;width:220px;height:130px;opacity:0;pointer-events:none;z-index:-1;border:0";

function applyIframeAttributes() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("dhun-yt-embed") as HTMLElement | null;
  const ifr = (el?.tagName === "IFRAME" ? el : el?.querySelector("iframe")) as HTMLIFrameElement | null;
  if (!ifr) return;
  ifr.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
  ifr.setAttribute("title", "Wave audio player");
  ifr.setAttribute("style", HIDDEN_STYLE);
}

/** Warm the IFrame API script early (on app mount) so the first play doesn't wait on it. */
export function prewarmApi() {
  loadApi().catch(() => {});
}

export function setHandlers(h: Handlers) {
  handlers = h;
}

/** Unmute without touching playback state. Safe to call from any listener, any time. */
export function unmuteNow() {
  if (soundBlocked && player) {
    try {
      player.unMute();
      player.setVolume(Math.round(volume01 * 100));
    } catch {}
    soundBlocked = false;
  }
}

/** Call from any real user gesture (play/pause/seek clicks) to restore sound after a muted autoplay. */
export function userGesture() {
  if (soundBlocked && player) {
    unmuteNow();
    player.playVideo();
  }
}

/** Mark the muted-autoplay fallback and install a ONE-TIME global capture listener:
 * the very next tap ANYWHERE on the page restores sound (users instinctively tap when
 * they hear nothing — this turns a silent dead-end into a one-tap fix). */
function markSoundBlocked() {
  soundBlocked = true;
  if (typeof document !== "undefined" && !autoRestoreInstalled) {
    autoRestoreInstalled = true;
    document.addEventListener("pointerdown", () => unmuteNow(), { capture: true });
  }
}

let volume01 = 1;

/** Create (or reuse) the hidden embed player. Safe to call on every play. */
export async function ensure(): Promise<boolean> {
  try {
    await createPlayer(handlers);
    available = true;
    return true;
  } catch {
    available = false;
    return false;
  }
}

/** Load a video and autoplay it. Returns false if the engine isn't available. */
export async function load(videoId: string, autoplay = true): Promise<boolean> {
  const ok = await ensure();
  const p = player;
  if (!ok || !p) return false;
  currentId = videoId;
  if (nudgeTimer) {
    clearInterval(nudgeTimer);
    nudgeTimer = null;
  }
  if (autoplay) {
    // Every load — including the very first — goes through loadVideoById. See the
    // note on createPlayer: the constructor-videoId path triggers spurious 150s.
    p.loadVideoById(videoId);
    // loadVideoById often just cues in strict browsers — nudge playVideo; if still
    // blocked after ~4s, fall back to MUTED autoplay (always permitted). Sound
    // returns on the next real gesture via userGesture().
    let tries = 0;
    let reissued = false;
    nudgeTimer = setInterval(() => {
      if (currentId !== videoId) {
        clearInterval(nudgeTimer!);
        nudgeTimer = null;
        return;
      }
      const st = p.getPlayerState();
      if (st === 1 || st === 3) {
        clearInterval(nudgeTimer!);
        nudgeTimer = null;
        return;
      }
      tries++;
      // Historic API quirk guard: some API builds silently drop the FIRST
      // loadVideoById on a brand-new player — if we're still fully unstarted
      // (-1) after two nudges, re-issue the load exactly once.
      if (tries === 3 && !reissued && st === -1) {
        reissued = true;
        p.loadVideoById(videoId);
      }
      if (tries > 6) {
        clearInterval(nudgeTimer!);
        nudgeTimer = null;
        if (st !== 1 && st !== 3) {
          markSoundBlocked();
          p.mute();
          p.playVideo();
        }
        return;
      }
      p.playVideo();
    }, 700);
  } else {
    p.cueVideoById(videoId);
  }
  return true;
}

export function play() {
  userGesture();
  player?.playVideo();
}

export function pause() {
  player?.pauseVideo();
}

export function seek(sec: number) {
  userGesture();
  player?.seekTo(sec, true);
}

export function setVolume(v01: number) {
  volume01 = v01;
  player?.setVolume(Math.round(Math.min(1, Math.max(0, v01)) * 100));
}

export function getTime(): number {
  const t = player?.getCurrentTime();
  return typeof t === "number" && Number.isFinite(t) ? t : 0;
}

export function getDuration(): number {
  const d = player?.getDuration();
  return typeof d === "number" && Number.isFinite(d) ? d : 0;
}

export function getState(): YtState {
  if (!player) return "unstarted";
  return stateMap[player.getPlayerState()] ?? "unstarted";
}

export function currentVideoId(): string | null {
  return currentId;
}

export function isSoundBlocked(): boolean {
  return soundBlocked;
}

/** Last-resort teardown (not normally needed; the player persists across tracks). */
export function destroy() {
  try {
    player?.destroy();
  } catch {}
  player = null;
  creating = null;
  currentId = null;
  available = false;
  document.getElementById("dhun-yt-embed")?.remove();
}
