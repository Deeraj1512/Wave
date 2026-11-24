"use client";

/**
 * Loudness BOOST — the "phone and laptop are too low" fix (Batch 2).
 *
 * Two platforms, two safe mechanisms:
 *
 *  - WEB (audio src = our same-origin /api/audio proxy): a Web Audio gain
 *    chain — element → GainNode → soft-knee DynamicsCompressor → output.
 *    Gain up to 2.0x with the compressor catching the peaks, so 200% stays
 *    loud without clipping. Same-origin media can always be routed through
 *    Web Audio — no CORS question here.
 *
 *  - NATIVE APK (audio src = googlevideo directly, cross-origin): googlevideo
 *    sends NO Access-Control-Allow-Origin headers (probed live + community
 *    confirmed), so routing that media through Web Audio would output SILENCE
 *    (Chromium taints cross-origin no-CORS media). The graph is attached in
 *    native only after a runtime CORS probe passes (future-proofing); today
 *    the APK boost is the honest lever: raising the system MEDIA volume to
 *    max via WaveAudio.raiseMediaVolume — plus the opus 160 kbps quality
 *    upgrade which plays noticeably cleaner at the same loudness.
 *
 * The chosen boost level persists (dhun.boost) and is restored on load.
 * Boost only ever shapes loudness — playback truth stays the audio element.
 */

const BOOST_KEY = "dhun.boost";

/** Boost levels — index 0 = off. Gain multipliers for the Web Audio chain. */
export const BOOST_GAINS = [1, 1.3, 1.6, 2];

type CapShape = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, { raiseMediaVolume?: (o: { steps: number }) => Promise<unknown>; mediaVolume?: () => Promise<{ current?: number; max?: number } | undefined> | undefined } | undefined>;
};

function cap(): CapShape | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapShape }).Capacitor;
}

function isNative(): boolean {
  return !!cap()?.isNativePlatform?.();
}

// ── level state (shared by both mechanisms) ──────────────────────────────────

let level = 0;
try {
  if (typeof window !== "undefined") {
    const n = Number(localStorage.getItem(BOOST_KEY));
    if (Number.isFinite(n) && n >= 0 && n <= BOOST_GAINS.length - 1) level = Math.round(n);
  }
} catch {
  /* private mode */
}

const listeners = new Set<() => void>();

export function getBoostLevel(): number {
  return level;
}

export function boostLabel(): string {
  return level === 0 ? "Off" : `+${Math.round((BOOST_GAINS[level] - 1) * 100)}%`;
}

export function setBoostLevel(next: number) {
  const prev = level;
  level = Math.max(0, Math.min(BOOST_GAINS.length - 1, Math.round(next)));
  try {
    localStorage.setItem(BOOST_KEY, String(level));
  } catch {
    /* private mode */
  }
  if (isNative()) applyNativeBoost(prev);
  else applyGain();
  for (const l of listeners) l();
}

export function subscribeBoost(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ── WEB: the Web Audio gain chain ────────────────────────────────────────────

let ctx: AudioContext | null = null;
let srcNode: MediaElementAudioSourceNode | null = null;
let gainNode: GainNode | null = null;
let attachedEl: HTMLAudioElement | null = null;
let nativeCorsOk: boolean | null = null; // probed once per session

function ensureGraph(el: HTMLAudioElement): boolean {
  if (attachedEl === el && ctx && gainNode) return true;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    // one source node per element, ever — creating a second throws
    srcNode = ctx.createMediaElementSource(el);
    gainNode = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    // soft-knee peak catcher: 200% stays musical, never crunchy
    comp.threshold.value = -6;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    srcNode.connect(gainNode);
    gainNode.connect(comp);
    comp.connect(ctx.destination);
    attachedEl = el;
    // autoplay policy: the context must be RUNNING when audio flows — resume
    // on every play tap, visibility return, and first pointer interaction
    const resume = () => {
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    el.addEventListener("play", resume);
    el.addEventListener("playing", resume);
    document.addEventListener("pointerdown", resume, true);
    document.addEventListener("visibilitychange", resume);
    resume();
    applyGain();
    return true;
  } catch {
    // graph attach failed (old WebView, source-node already created…) —
    // fall back to plain element playback, boost simply stays off
    gainNode = null;
    attachedEl = null;
    return false;
  }
}

function applyGain() {
  if (gainNode) {
    const g = ctx ? Math.max(1e-4, ctx.currentTime) : 0;
    // ramp 120ms — a stepped jump clicks on some devices
    gainNode.gain.setTargetAtTime(BOOST_GAINS[level], g, 0.04);
  }
}

// ── NATIVE: CORS probe (future-proof) + the honest system-volume lever ───────

async function googlevideoCorsOk(url: string): Promise<boolean> {
  if (nativeCorsOk !== null) return nativeCorsOk;
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(6000) });
    await res.body?.cancel().catch(() => {});
    // a CORS-failing response rejects outright; reaching here with ok/206 means
    // the edge DOES answer CORS for media → the graph is safe to attach
    nativeCorsOk = res.status === 206 || res.status === 200;
  } catch {
    nativeCorsOk = false; // googlevideo today: no ACAO → the graph must never attach
  }
  return nativeCorsOk;
}

let raisedFrom: number | null = null; // device volume before we raised it (restore on Off)

async function applyNativeBoost(prev: number) {
  const p = cap()?.Plugins?.WaveAudio;
  if (!p?.raiseMediaVolume || !p?.mediaVolume) return;
  try {
    if (level > 0 && prev === 0) {
      const v = await p.mediaVolume();
      const cur = v?.current ?? 0;
      const max = v?.max ?? 15;
      if (cur < max) {
        raisedFrom = cur;
        await p.raiseMediaVolume({ steps: max - cur });
      }
    } else if (level === 0 && raisedFrom !== null) {
      // Off → put the device volume back where the user had it
      const v = await p.mediaVolume();
      const cur = v?.current ?? 0;
      if (cur > raisedFrom) {
        await p.raiseMediaVolume({ steps: raisedFrom - cur }); // negative steps lower it
      }
      raisedFrom = null;
    }
  } catch {
    /* the device-volume nudge is best-effort */
  }
}

/**
 * Attach loudness shaping to the player's audio element.
 *  - WEB: attach immediately (same-origin proxy — always safe).
 *  - NATIVE: attach only when a live probe shows googlevideo answers CORS
 *    (never today — the probe guards against future CDN changes); the real
 *    native boost is the system-volume lever applied by setBoostLevel.
 * Called once when the element is created; repeated calls are no-ops.
 */
export async function attachBoost(el: HTMLAudioElement): Promise<void> {
  if (!isNative()) {
    ensureGraph(el);
    return;
  }
  const src = el.src || el.currentSrc;
  if (src && (await googlevideoCorsOk(src))) ensureGraph(el);
}

/**
 * The current boost applies to a freshly created element (e.g. after attach).
 */
export function applyBoostTo(el: HTMLAudioElement) {
  if (attachedEl === el) applyGain();
}

// ── dev/diagnostic: which mechanism is live ──────────────────────────────────

export function boostMode(): "webaudio" | "volume" | "off" {
  if (isNative()) return "volume";
  return gainNode ? "webaudio" : "off";
}
