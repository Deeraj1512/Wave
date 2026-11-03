"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Lang, Track } from "./types";
import { audioUrlFor, radioApi, searchApi, IS_NATIVE, resolveNativeAudio, invalidateNativeAudio } from "./api";
import { notifyPlayState, notifyNativeMedia, notifyNativeProgress } from "./nativeBackground";
import { recordPlay, topArtists } from "./history";
import { detectTrackLang, inferLiveLang } from "./langs";
import * as ytEmbed from "./ytEmbed";
import {
  initMediaSession,
  syncTrackMetadata,
  reassertMetadata,
  setPlaybackState,
  pushPositionState,
  clearMediaSession,
  ensureAnchorAudio,
  setAnchorPlaying,
  bumpAnchorFocus,
} from "./mediaSession";

/** a real YouTube videoId: exactly 11 url-safe chars (mock catalog ids are "t01"-style) */
const VIDEO_ID_RE = /^[\w-]{11}$/;
const JUNK_RE = /\bremix\b|\bmashup\b|\binstrumental\b|\bkaraoke\b|\bcover\b|\bslowed\b|\breverb\b|\bsped\s?up\b|\b8d\b|\bnightcore\b|\bjukebox\b|\blofi\b/i;

/** Where the user can ALWAYS hear this track — real videoId → watch page, mock id → search. */
export function ytLinkFor(t: Track): string {
  return VIDEO_ID_RE.test(t.id)
    ? `https://www.youtube.com/watch?v=${t.id}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.title} ${t.artist}`)}`;
}

/**
 * Playback engines, tried in order:
 *  1. "direct" — server resolves a googlevideo URL through Echo's client chain (VISIONOS →
 *     ANDROID_VR → TVHTML5) and pipes it via /api/audio. Best quality, no ads.
 *  2. "embed"  — hidden YouTube IFrame player driven by the IFrame API. Runs in the USER's
 *     browser, so server IP / bot-gates are irrelevant. Used automatically whenever direct
 *     resolution fails.
 *  3. "sim"    — last resort if neither engine can deliver: simulated progress keeps the UI alive.
 */

export type Engine = "direct" | "embed" | "sim";

/** Repeat mode — the player's loop button cycles off → all → one → off. */
export type RepeatMode = 0 | 1 | 2; // 0 = off · 1 = loop all · 2 = loop one

export type SleepTimerState = { mode: "time"; endsAt: number; minutes: number } | { mode: "track" } | null;
export type SleepTimerInput = { minutes: number } | "track" | null;

// ── Queue model (the best of Spotify + YouTube Music) ────────────────────────
// One physical queue, three layers — exactly how YTM's flat list behaves, but with
// Spotify's manual-queue priority:
//   [ ...played... ] current [ manual: "Next in queue" (jumps the line) ]
//                          [ context: "Playing from ⟨label⟩" ]
//                          [ radio: "Autoplay" (fetched from /api/radio, infinite) ]

export type QueueLayer = "manual" | "context" | "radio";

export interface QTrack extends Track {
  uid: string;
  layer: QueueLayer;
}

/**
 * Autoplay flavor — YTM's queue filter chips (screenshot: All / Familiar / Discover /
 * Party / Tamil / Telugu). "lang:X" biases the autoplay block to one language.
 */
export type RadioMode = "all" | "familiar" | "discover" | "party" | `lang:${Lang}`;

export function radioModeLabel(m: RadioMode): string {
  if (m === "all") return "All";
  if (m.startsWith("lang:")) return m.slice(5);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** "Arijit Singh, Shreya Ghoshal" → "arijit singh" — familiarity matching key. */
function primaryArtist(artist: string): string {
  return artist.split(",")[0].trim().toLowerCase();
}

const PARTY_TITLE_RE = /\b(party|dance|banger|club|disco|drinks|daaru|kuthu|dappu|step)\b/i;

/**
 * Shape the raw radio pool into the chip's flavor. The pool always comes from the
 * playing song's own Mix (RDAMVM) — modes only re-RANK or blend it, so the block
 * stays related to what's playing no matter which chip is lit.
 */
async function shapeForMode(mode: RadioMode, pool: Track[], seedTrack: QTrack | undefined): Promise<Track[]> {
  if (mode === "all") return pool;

  if (mode === "familiar" || mode === "discover") {
    // Familiar = artists from your listening history first; Discover = the opposite
    const familiar = new Set(topArtists(15).map(primaryArtist));
    const matched = pool.filter((t) => familiar.has(primaryArtist(t.artist)));
    const rest = pool.filter((t) => !familiar.has(primaryArtist(t.artist)));
    return mode === "familiar" ? [...matched, ...rest] : [...rest, ...matched];
  }

  if (mode === "party") {
    const lang = seedTrack ? detectTrackLang(seedTrack) : undefined;
    try {
      const found = await searchApi(`party songs${lang ? ` ${lang.toLowerCase()}` : ""}`);
      const radioParty = pool.filter((t) => PARTY_TITLE_RE.test(t.title));
      const seen = new Set<string>();
      const merged: Track[] = [];
      for (const t of [...found.slice(0, 15), ...radioParty]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        merged.push(t);
      }
      return merged.length >= 5 ? merged : [...merged, ...pool.filter((t) => !seen.has(t.id))];
    } catch {
      return pool;
    }
  }

  // lang:<X> — blend a language search with the Mix tracks that are in that language
  const lang = mode.slice(5) as Lang;
  try {
    const found = await searchApi(`${lang.toLowerCase()} hit songs`);
    const head = found.slice(0, 15);
    const seen = new Set(head.map((t) => t.id));
    return [...head, ...pool.filter((t) => !seen.has(t.id) && (t.lang === lang || detectTrackLang(t) === lang))];
  } catch {
    return pool.filter((t) => t.lang === lang || detectTrackLang(t) === lang);
  }
}

/**
 * Lead an autoplay block with the seed song's own artist/composer (up to 5), so the
 * "similar vibe / related artist" promise is literally visible in the first rows —
 * YTM mixes do the same: the seed's artist dominates the top of the block.
 */
function promoteSeedArtist(seed: Track, pool: Track[]): Track[] {
  const keys = new Set(seed.artist.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
  if (keys.size === 0) return pool;
  const same: Track[] = [];
  const rest: Track[] = [];
  for (const t of pool) {
    const match = t.artist.split(",").some((a) => keys.has(a.trim().toLowerCase()));
    if (match && same.length < 5) same.push(t);
    else rest.push(t);
  }
  return [...same, ...rest];
}

/** "(Telugu)", "(From "Aashiqui 2")", "– Hindi", version suffixes — noise hiding that two titles are the same song. */
const TITLE_NOISE_RE =
  /\s*\((?:from[^)]*|\b\d{4}\b|telugu|hindi|tamil|kannada|malayalam|punjabi|bengali|english|version|reprised?|unplugged|acoustic|lo-?fi)\)\s*|\s[-–]\s*(?:telugu|hindi|tamil|kannada|malayalam)\s*$/gi;

/** "Massa Massa (Hindi)" and "Massa Massa (Telugu)" collapse to the same base song. */
function baseTitle(title: string): string {
  return title.replace(TITLE_NOISE_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * YTM language-stationary radio: a radio seeded by a Telugu song STAYS Telugu.
 * YouTube's raw mix drifts across languages for multilingual composers (an A.R. Rahman
 * seed returns his Hindi/Kannada/Tamil versions), so the block is rebuilt in language
 * buckets — seed-language tracks first (its own artist/composer leading them), then
 * tracks whose language we can't detect, and other languages only as filler when the
 * in-language pool can't nearly fill a block. The same song in another language
 * ("Massa Massa (Hindi)" behind "(Telugu)") counts as drift, not variety.
 */
function relateBlock(seed: Track, pool: Track[]): Track[] {
  // the seed can be a romanized live track too — infer before locking the block
  const lang = detectTrackLang(seed) ?? inferLiveLang(seed);
  if (!lang) return promoteSeedArtist(seed, pool);
  const seedBase = baseTitle(seed.title);
  const isVariant = (t: Track) => baseTitle(t.title) === seedBase;
  // language of a pool track: explicit marker / native script first, then the
  // catalog-backed inference (movie names + artist profiles) for romanized titles
  const langOf = (t: Track) => detectTrackLang(t) ?? inferLiveLang(t, lang);
  const same = pool.filter((t) => langOf(t) === lang && !isVariant(t));
  const unknown = pool.filter((t) => langOf(t) === undefined && !isVariant(t));
  const other = pool.filter((t) => {
    const l = langOf(t);
    return (l !== undefined && l !== lang) || isVariant(t);
  });
  const head = promoteSeedArtist(seed, same);
  const tail =
    same.length + unknown.length >= 10
      ? promoteSeedArtist(seed, unknown) // plenty in-language → no drift this block
      : promoteSeedArtist(seed, [...unknown, ...other]); // thin pool → drift as filler, artist-led
  return [...head, ...tail];
}

/**
 * Artist-spaced shuffle (Spotify's 2014 "balanced shuffle"): group by primary artist,
 * interleave the groups evenly across the timeline with a little jitter, then shuffle
 * within each group. Same-artist tracks never clump — feels more random than random.
 */
export function balancedShuffle<T extends { artist: string }>(tracks: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const t of tracks) {
    const a = t.artist.split(",")[0].trim().toLowerCase();
    const g = groups.get(a);
    if (g) g.push(t);
    else groups.set(a, [t]);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: (T | undefined)[] = new Array(tracks.length).fill(undefined);
  let free = out.map((_, i) => i); // ascending free slots
  for (const g of sorted) {
    // shuffle within the group
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
    // spread this group's tracks across the currently-free slots (evenly + jitter)
    const n = free.length;
    const picks = new Set<number>();
    g.forEach((t, k) => {
      let slot = Math.floor((k * n) / g.length + (Math.random() - 0.5) * Math.max(1, Math.floor(n / g.length / 2)));
      slot = Math.min(n - 1, Math.max(0, slot));
      while (picks.has(slot) && picks.size < n) slot = (slot + 1) % n;
      picks.add(slot);
      out[free[slot]] = t;
    });
    free = free.filter((_, idx) => !picks.has(idx));
  }
  // every track belongs to exactly one group and every group found a free slot,
  // so `out` is fully populated at this point.
  return out as T[];
}

interface PlayerState {
  current: Track | null;
  /** merged physical queue: manual + context + radio layers (see QTrack.layer) */
  queue: QTrack[];
  queueIndex: number;
  /** "Playing from ⟨label⟩" — the source of the context layer */
  playingFrom: string | null;
  /** autoplay (radio) layer on/off — YTM's queue toggle */
  autoplay: boolean;
  /** autoplay flavor — YTM's queue chips (All / Familiar / Discover / Party / language) */
  radioMode: RadioMode;
  setRadioMode: (m: RadioMode) => void;
  radioLoading: boolean;
  isPlaying: boolean;
  progress: number; // seconds
  expanded: boolean;
  shuffle: boolean;
  /** 0 = off · 1 = loop all · 2 = loop one (RepeatMode) */
  repeat: number;
  /** sleep timer — pauses playback when it fires (after N min, or end of current song) */
  sleepTimer: SleepTimerState;
  setSleepTimer: (t: SleepTimerInput) => void;
  volume: number;
  likedIds: Set<string>;
  /** active delivery engine for the current track */
  engine: Engine;
  /** true when the real stream is notably shorter than the track (preview-cap fallback) */
  previewLimited: boolean;
  buffering: boolean;
  /** embed fell back to muted autoplay — UI shows a "tap for sound" pill */
  soundBlocked: boolean;
  playTrack: (t: Track, context?: Track[], label?: string) => void;
  addToQueue: (t: Track) => void;
  playNext: (t: Track) => void;
  removeFromQueue: (uid: string) => void;
  jumpTo: (uid: string) => void;
  /** drag-reorder: replace everything after the current track with a new order */
  reorderUpcoming: (next: QTrack[]) => void;
  /** Spotify's "Clear queue" — drop every manually-queued song */
  clearManualQueue: () => void;
  /** undo helper — put a removed item back at its exact old position */
  reinsertQueueItem: (item: QTrack, index: number) => void;
  /** YTM's "Start radio" — splice a seed-matched radio after a row (or start one from a fresh track) */
  startRadio: (t: Track, uid?: string) => void;
  /** YTM single-tap semantics: play t now; its radio (seeded by t, artist-led) fills the queue behind it */
  playRadio: (t: Track, label?: string) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setExpanded: (v: boolean) => void;
  toggleShuffle: () => void;
  /** three-click loop cycle: off → all → one → off (YTM/Spotify grammar) */
  cycleRepeat: () => void;
  toggleAutoplay: () => void;
  setVolume: (v: number) => void;
  restoreSound: () => void;
  toggleLike: (id: string, t?: Track) => void;
  /** liked ids resolved to full tracks (snapshots captured at like time) — newest like first */
  likedTracks: Track[];
}

const Ctx = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playingFrom, setPlayingFrom] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("dhun.autoplay") !== "off";
    } catch {
      return true;
    }
  });
  const [radioMode, setRadioModeState] = useState<RadioMode>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const v = localStorage.getItem("dhun.radioMode");
      return v && /^(all|familiar|discover|party|lang:.+)$/.test(v) ? (v as RadioMode) : "all";
    } catch {
      return "all";
    }
  });
  const [radioLoading, setRadioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>(0);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimerState>(null);
  // Volume defaults to MAX (user request) and remembers the user's own choice.
  const [volume, setVolumeState] = useState(() => {
    if (typeof window === "undefined") return 1;
    try {
      const v = Number(localStorage.getItem("dhun.volume"));
      return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  /** full track snapshots for liked ids (many liked ids are live videoIds not in any catalog) */
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [engine, setEngine] = useState<Engine>("direct");
  const [previewLimited, setPreviewLimited] = useState(false);
  const [buffering, setBuffering] = useState(false);
  /** embed fell back to muted autoplay — UI shows a "tap for sound" pill */
  const [soundBlocked, setSoundBlocked] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<Engine>("direct");
  const simTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simModeRef = useRef(false);
  const pendingRef = useRef(false); // whether a load is in flight for the current track
  const loadedIdRef = useRef<string | null>(null); // id of the track playback was started for
  const volumeRef = useRef(volume);
  const playingFromRef = useRef<string | null>(null);
  const directTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uidSeqRef = useRef(0);
  /** live play/pause mirror for media-session handlers (OS lock-screen buttons) */
  const isPlayingRef = useRef(false);

  // queue mirrors for async callbacks (refs updated in effects — react-compiler safe)
  const queueRef = useRef<QTrack[]>([]);
  const queueIndexRef = useRef(0);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>(0);
  /** sleep-at-track-end — read by the natural-end funnel without re-rendering engines */
  const sleepTrackEndRef = useRef(false);
  const autoplayRef = useRef(autoplay);
  const radioModeRef = useRef<RadioMode>(radioMode);
  const radioLoadingRef = useRef(false);
  const radioTriedRef = useRef<Set<string>>(new Set()); // seeds already fetched this context
  /** a chip tap arrived while a radio fetch was in flight — re-run extendRadio once it settles */
  const pendingRadioRef = useRef(false);
  /** the live radio fetch (extendRadio or startRadio) — callers can await its settle */
  const radioInFlightRef = useRef<Promise<boolean> | null>(null);
  /** bumped on chip/context switches — in-flight radio appends from the old flavor are discarded */
  const radioEpochRef = useRef(0);
  const extendRadioRef = useRef<() => Promise<boolean>>(async () => false);
  /** order of the upcoming non-manual block before shuffle — restored when shuffle turns off */
  const savedOrderRef = useRef<QTrack[] | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  });
  useEffect(() => {
    queueIndexRef.current = queueIndex;
  });
  useEffect(() => {
    shuffleRef.current = shuffle;
  });
  useEffect(() => {
    repeatRef.current = repeat;
  });
  useEffect(() => {
    sleepTrackEndRef.current = sleepTimer?.mode === "track";
  }, [sleepTimer]);
  useEffect(() => {
    autoplayRef.current = autoplay;
  });
  useEffect(() => {
    radioModeRef.current = radioMode;
  });
  useEffect(() => {
    extendRadioRef.current = extendRadio;
  });

  const current = queue[queueIndex] ?? null;
  const currentRef = useRef<Track | null>(null);
  useEffect(() => {
    currentRef.current = current;
  });
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  });

  // Warm-up at app load: the YT IFrame API (embed fallback) plus the on-device Echo
  // resolve chunk, so the first play never pays the dynamic-module load cost.
  // (The old /api/stream-health probe is gone: the server no longer mints URLs —
  // the CLIENT does — so a bot-gated deployment IP must not steer the engine choice.)
  useEffect(() => {
    ytEmbed.prewarmApi();
    void import("./yt/resolve").catch(() => {});
  }, []);

  const setEngineBoth = useCallback((m: Engine) => {
    engineRef.current = m;
    setEngine(m);
    if (typeof window !== "undefined") (window as any).__dhunEngine = m; // debug handle
  }, []);

  // lazily create the audio element (direct engine)
  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      // Background-play bridge (APK): the native foreground service follows the
      // element's audible state so Android never freezes the process mid-song.
      // On web notifyPlayState is a no-op. Each event rides the exact position
      // snapshot along so the card's seek bar anchors to truth (Android
      // extrapolates the seconds in between itself).
      const snap = () => ({
        position: a.currentTime || 0,
        duration: Number.isFinite(a.duration) && a.duration > 0 ? a.duration : undefined,
      });
      a.addEventListener("playing", () => notifyPlayState(true, snap()));
      a.addEventListener("pause", () => notifyPlayState(false, snap()));
      a.addEventListener("seeked", () => notifyPlayState(isPlayingRef.current, snap()));
      a.addEventListener("ended", () => notifyPlayState(false));
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const clearSimTick = useCallback(() => {
    if (simTickRef.current) {
      clearInterval(simTickRef.current);
      simTickRef.current = null;
    }
  }, []);

  // ── simulated playback (final fallback) ─────────────────────────────────────
  const simProgressRef = useRef(0);
  // ── progress setState budget ──
  // Ticking sources (audio timeupdate ~4Hz, embed poll 2Hz) used to setState on
  // every tick → the provider value changed → EVERY consumer (mini bar, full
  // player, queue sheet, page) re-rendered 2–4×/sec. On phones that steals the
  // main thread from the enter/exit springs and the pan gestures — the frame
  // drops the user felt. The UI only renders whole seconds (fmtTime + the ~1Hz
  // scrubber sync), so ticking updates are QUANTIZED to integer-second flips
  // (≤1Hz, pixel-identical on screen). Seek / track-change / loop-restart stay
  // EXACT via setProgressExact, which re-anchors the quantizer.
  const shownSecRef = useRef(-1);
  const setProgressExact = useCallback((t: number) => {
    shownSecRef.current = Math.floor(t);
    setProgress(t);
  }, []);
  const tickProgress = useCallback((t: number) => {
    const s = Math.floor(t);
    if (s === shownSecRef.current) return;
    shownSecRef.current = s;
    setProgress(t);
  }, []);

  const startSim = useCallback(
    (fromSec = 0) => {
      clearSimTick();
      setEngineBoth("sim");
      simModeRef.current = true;
      simProgressRef.current = fromSec;
      setProgressExact(fromSec);
      setBuffering(false);
      setIsPlaying(true);
      simTickRef.current = setInterval(() => {
        // a 0/garbage catalog duration would end every tick instantly (skip-chain) —
        // fall back to a sane default length instead
        const rawDur = currentRef.current?.duration ?? 0;
        const dur = rawDur > 0 ? rawDur : 200;
        const p = simProgressRef.current + 1;
        if (p >= dur) {
          // one funnel for every natural end: sleep-at-end pause · repeat-one restart · advance
          trackEndRef.current();
          return;
        }
        simProgressRef.current = p;
        tickProgress(p);
      }, 1000);
    },
    [clearSimTick, setEngineBoth, setProgressExact, tickProgress]
  );

  const stopSim = useCallback(() => {
    clearSimTick();
    simModeRef.current = false;
  }, [clearSimTick]);

  /** consecutive tracks that failed to START (embed errored/exhausted). ≥5 means the
   *  environment can't play audio right now (bot-gate / offline) — stop the skip-chain
   *  instead of flickering through the whole queue. Reset the moment audio actually plays. */
  const failStreakRef = useRef(0);
  /** watchdog firings where the embed NEVER reached playing for this track. A bot-walled
   *  iframe "loads" fine (loadVideoById resolves) but stays unstarted forever — without
   *  this cap the sibling-retry chain would spin 11s→11s→… indefinitely and the user just
   *  sees eternal buffering. 2 sibling attempts, then give up on the track and skip. */
  const embedNoStartRef = useRef(0);

  /**
   * What to do when the current track is UNPLAYABLE (embed errored/exhausted, no
   * sibling upload worked). YTM doesn't fake-play a dead song — it skips it. If the
   * queue can move (more tracks ahead, or autoplay can extend the radio), advance;
   * only the true dead-end (last track, autoplay off) falls back to the silent sim
   * preview, which the UI marks as "preview mode" with a YouTube link.
   */
  /** parked because the whole environment can't play — tell the user WHY (once) */
  const blockedNotifiedRef = useRef(false);
  const notifyBlocked = useCallback(() => {
    if (blockedNotifiedRef.current) return;
    blockedNotifiedRef.current = true;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("dhun:playback-blocked"));
  }, []);

  const skipOrFail = useCallback(() => {
    failStreakRef.current++;
    if (failStreakRef.current >= 5) {
      // five tracks in a row failed to start — parking paused beats an endless
      // buffering-flicker tour of the queue (YTM parks with an error snackbar too)
      setIsPlaying(false);
      setBuffering(false);
      notifyBlocked();
      return;
    }
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (q.length - i > 1 || autoplayRef.current) {
      void advanceRef.current(false);
      // if advance couldn't move us anywhere (extend failed at the end), park paused
      // — and say WHY (the queue died on an unstartable track)
      setTimeout(() => {
        if (queueIndexRef.current === i && !embedStartedRef.current) {
          setIsPlaying(false);
          notifyBlocked();
        }
      }, 900);
    } else {
      startSim(0);
    }
  }, [startSim, notifyBlocked]);

  // ── embed engine plumbing ────────────────────────────────────────────────────
  const embedTriedRef = useRef<Set<string>>(new Set()); // videoIds tried for the current track
  const embedTrackKeyRef = useRef<string | null>(null);
  /** set once the embed reaches playing/buffering for the current load (watchdog signal) */
  const embedStartedRef = useRef(false);
  const embedWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const embedSiblingRetryRef = useRef<((t: Track) => Promise<boolean>) | null>(null);
  /** timestamp of the last embed load — used to detect fast (immediate-reject) failures */
  const embedLoadAtRef = useRef(0);
  /** consecutive loads rejected within ~2.5s — ≥3 means this song is unplayable here */
  const embedErrStreakRef = useRef(0);

  // If the embed never reaches playing/buffering within 11s (sign-in wall inside the iframe,
  // dead upload, blocked network), retry a sibling upload — else drop to sim so the UI
  // never sits stuck on "buffering" forever.
  const armEmbedWatchdog = useCallback(
    (track: Track) => {
      if (embedWatchdogRef.current) clearTimeout(embedWatchdogRef.current);
      embedWatchdogRef.current = setTimeout(() => {
        embedWatchdogRef.current = null;
        if (engineRef.current === "embed" && !embedStartedRef.current) {
          embedNoStartRef.current++;
          if (embedNoStartRef.current >= 3) {
            skipOrFail();
            return;
          }
          void embedSiblingRetryRef.current?.(track).then((ok) => {
            if (!ok && engineRef.current === "embed") skipOrFail();
          });
        }
      }, 11000);
    },
    [skipOrFail]
  );

  // Some uploads block embedding (YT error 100/101/150). Retry with a sibling upload of the
  // same song found via search — identical audio, different videoId. Queries rotate per
  // attempt (each surfaces different uploads) and candidates are ranked by title-token
  // overlap + duration proximity. A fast-fail streak (every load rejected within ~2.5s by
  // the same error class) means THIS SONG has no embeddable upload from this environment —
  // stop churning siblings and let the queue skip ahead.
  const embedSiblingRetry = useCallback(
    async (track: Track): Promise<boolean> => {
      if (embedTriedRef.current.size > 4) return false;
      if (embedErrStreakRef.current >= 3) return false;
      const attempt = embedTriedRef.current.size;
      const artistFirst = track.artist.split(",")[0].trim();
      const queries = [
        `${track.title} ${artistFirst} song`,
        `${track.title} song`,
        `${track.title} ${artistFirst}`,
        `${track.title}`,
      ];
      try {
        const res = await searchApi(queries[attempt % queries.length]).catch(() => []);
        const JUNK = JUNK_RE;
        const seedToks = track.title
          .toLowerCase()
          .replace(/\(from[^)]*\)/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const score = (t: Track): number => {
          const ti = t.title.toLowerCase();
          const hits = seedToks.filter((w) => ti.includes(w)).length;
          const durOk = track.duration > 30 && Math.abs(t.duration - track.duration) <= 90 ? 1 : 0;
          return hits * 2 + durOk;
        };
        const sib = res
          .filter((t) => !embedTriedRef.current.has(t.id) && t.duration >= 45 && !JUNK.test(t.title))
          .sort((a, b) => score(b) - score(a))[0];
        // must be the SAME SONG: at least one seed-title token must appear in the
        // sibling title (hits*2). Duration similarity alone accepts wrong songs.
        if (!sib || (seedToks.length > 0 && score(sib) < 2)) return false;
        embedTriedRef.current.add(sib.id);
        setBuffering(true);
        embedStartedRef.current = false;
        ytEmbed.setVolume(volumeRef.current);
        embedLoadAtRef.current = Date.now();
        const ok = await ytEmbed.load(sib.id, true);
        if (ok) armEmbedWatchdog(track);
        return ok;
      } catch {
        return false;
      }
    },
    [armEmbedWatchdog]
  );
  useEffect(() => {
    embedSiblingRetryRef.current = embedSiblingRetry;
  }, [embedSiblingRetry]);

  const startProgressPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      if (engineRef.current !== "embed") return;
      setSoundBlocked(ytEmbed.isSoundBlocked());
      const tr = currentRef.current;
      if (!tr) return;
      // Only trust the embed while it reports a video that belongs to the CURRENT
      // track (the resolved pick or a sibling retry — embedTriedRef holds both).
      // Between ytEmbed.pause() (track switch) and the new video's first frame, the
      // iframe still reports the OLD song's position; without this gate that stale
      // time is pumped into the new track's elapsed/seek bar — wrong timings and a
      // jumpy progress bar in BOTH players (they share this state) — until it snaps
      // back when the new video starts.
      const vid = ytEmbed.currentVideoId();
      if (!vid || !embedTriedRef.current.has(vid)) return;
      const t = ytEmbed.getTime();
      if (t > 0) tickProgress(t);
      // duration truth-sync — the ENGINE is the only truth for the total. Adopt it as
      // soon as metadata lands (during buffering, long before the bar starts moving):
      // elapsed, the seek bar and the ENDED event then share one exact total from the
      // first tick, and the shown total never flips mid-playback. (The old ±15% window
      // let catalog estimates — up to ±90s off — govern the bar for the whole track:
      // it filled early and sat at 100% while time kept counting, or never reached
      // the end. And sibling uploads (videoId ≠ record id) never synced at all.)
      const d = ytEmbed.getDuration();
      if (d > 30 && Math.round(d) !== tr.duration) {
        if (tr.duration > 30 && d < tr.duration * 0.85) setPreviewLimited(true);
        setQueue((q) => q.map((x) => (x.id === tr.id ? { ...x, duration: Math.round(d) } : x)));
      }
    }, 500);
  }, [tickProgress]);

  /** the direct stream URL armed for the CURRENT track — the session save keeps it
   *  so a reload re-arms the exact live URL (googlevideo URLs stay valid for hours
   *  on the same IP) instead of paying a fresh resolve */
  const streamUrlRef = useRef<{ id: string; url: string } | null>(null);

  const embedPlay = useCallback(
    (track: Track, opts?: { startAt?: number }) => {
      const startAt = Math.max(0, Math.floor(opts?.startAt ?? 0));
      stopSim();
      // belt & suspenders: never let a lingering direct-engine stream double-play under us
      audioRef.current?.pause();
      streamUrlRef.current = null; // the engine left the direct path — its saved URL is stale
      setProgressExact(startAt);
      setPreviewLimited(false);
      setBuffering(true);
      setEngineBoth("embed");
      embedStartedRef.current = false;
      embedLoadAtRef.current = Date.now();
      if (embedTrackKeyRef.current !== track.id) {
        embedTrackKeyRef.current = track.id;
        embedTriedRef.current = new Set([track.id]);
        embedErrStreakRef.current = 0;
        embedNoStartRef.current = 0;
      }
      ytEmbed.setVolume(volumeRef.current);
      ytEmbed.setHandlers({
        onState: (s) => {
          if (engineRef.current !== "embed") return;
          if (s === "playing") {
            embedStartedRef.current = true;
            embedNoStartRef.current = 0;
            failStreakRef.current = 0; // audio is flowing — the failure chain is over
            if (embedWatchdogRef.current) {
              clearTimeout(embedWatchdogRef.current);
              embedWatchdogRef.current = null;
            }
            setBuffering(false);
            setIsPlaying(true);
            notifyPlayState(true, { position: ytEmbed.getTime(), duration: ytEmbed.getDuration() });
            stopSim();
            // the iframe's own session just (re)claimed audio focus — re-take the
            // OS card for Wave's session (freshest audible media wins)
            bumpAnchorFocus();
          } else if (s === "paused") {
            // a deliberate pause is healthy playback — stand down the failure watchdog
            setIsPlaying(false);
            notifyPlayState(false, { position: ytEmbed.getTime(), duration: ytEmbed.getDuration() });
            if (embedWatchdogRef.current) {
              clearTimeout(embedWatchdogRef.current);
              embedWatchdogRef.current = null;
            }
          } else if (s === "buffering") {
            setBuffering(true);
            // KEEP the watchdog armed while buffering — a hang here (sign-in/bot wall
            // inside the iframe, dead CDN edge) must still resolve via sibling/skip
            // instead of spinning on "buffering…" forever. It disarms on playing/paused.
            armEmbedWatchdog(track);
          } else if (s === "ended") {
            notifyPlayState(false);
            trackEndRef.current();
          }
        },
        onError: () => {
          // embed-disabled/unavailable → try a sibling upload of the same song, else skip
          if (engineRef.current !== "embed") return;
          if (Date.now() - embedLoadAtRef.current < 2500) embedErrStreakRef.current++;
          else embedErrStreakRef.current = 0;
          if (embedWatchdogRef.current) {
            clearTimeout(embedWatchdogRef.current);
            embedWatchdogRef.current = null;
          }
          void embedSiblingRetry(track).then((ok) => {
            if (!ok && engineRef.current === "embed") skipOrFail();
          });
        },
      });
      startProgressPoll();
      ytEmbed.load(track.id, true, startAt).then((ok) => {
        if (!ok && engineRef.current === "embed") skipOrFail();
        else if (ok) armEmbedWatchdog(track);
      });
    },
    [armEmbedWatchdog, embedSiblingRetry, skipOrFail, startProgressPoll, stopSim, setEngineBoth, setProgressExact]
  );

  // ── direct engine: load + play, with a hard timeout so gated resolves never stall ──
  /** generation token — a stale `{once}` listener from a superseded load must never act */
  const directLoadSeqRef = useRef(0);
  const loadDirect = useCallback(
    (track: Track, opts?: { startAt?: number; paused?: boolean; pauseOnDenied?: boolean; restored?: boolean; directUrl?: string }) => {
      const startAt = Math.max(0, Math.floor(opts?.startAt ?? 0));
      const paused = opts?.paused ?? false;
      const pauseOnDenied = opts?.pauseOnDenied ?? false;
      // restored sessions never auto-skip or muted-embed on total engine failure —
      // the song the user last heard STAYS on screen exactly where they left it
      const restored = opts?.restored ?? false;
      stopSim();
      setEngineBoth("direct");
      setProgressExact(0);
      setPreviewLimited(false);
      setBuffering(true);
      const a = getAudio();
      a.volume = volumeRef.current;
      const mySeq = ++directLoadSeqRef.current;

      const flipToEmbed = () => {
        if (directLoadSeqRef.current !== mySeq) return; // superseded by a newer load
        if (directTimerRef.current) {
          clearTimeout(directTimerRef.current);
          directTimerRef.current = null;
        }
        if (restored) {
          a.pause();
          if (paused) {
            // restored-paused: hold — the song wasn't playing; one tap resumes it
            // at the saved second. Re-assert the display: the failed arm means no
            // metadata ever landed, so a stray timeupdate would re-anchor to 0.
            setProgressExact(startAt);
            setBuffering(false);
            setIsPlaying(false);
            return;
          }
          // restored PLAYING (refresh / cold start): the song must NOT stop — the
          // embed engine picks the track up at the gap-compensated second. If the
          // fresh page denies sound, the embed falls back to muted autoplay (always
          // permitted) so the counter keeps flowing; the first tap restores audio.
          // (This used to park the song because the embed could only restart from
          // zero — load() now accepts startSeconds.)
          embedPlay(track, { startAt });
          return;
        }
        // CRITICAL: the direct stream may still be live (slow resolve that lands late).
        // Pause it BEFORE the embed starts or both play at once — the classic glitch.
        a.pause();
        if (engineRef.current === "direct") embedPlay(track);
      };
      const onLoaded = () => {
        if (directLoadSeqRef.current !== mySeq) return;
        if (directTimerRef.current) {
          clearTimeout(directTimerRef.current);
          directTimerRef.current = null;
        }
        setBuffering(false);
        // session-restore position — clamp inside the element's real length
        if (startAt > 0 && Number.isFinite(a.duration) && a.duration > 0) {
          try {
            a.currentTime = Math.min(startAt, Math.max(0, a.duration - 1));
          } catch {
            /* a mid-load seek can throw — the song just starts from 0 */
          }
        }
        // duration truth-sync (same contract as the embed poll): the element's real
        // length is adopted the moment metadata lands — loadedmetadata fires before
        // playback — so the total is exact from the first tick and never flips mid-track
        if (a.duration > 30 && Math.round(a.duration) !== track.duration) {
          if (track.duration > 30 && a.duration < track.duration * 0.85) setPreviewLimited(true);
          setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, duration: Math.round(a.duration) } : t)));
        }
      };

      /** attach the listener contract + stall timer + start playback (shared by both runtimes) */
      const arm = (src: string, onErr: () => void) => {
        streamUrlRef.current = { id: track.id, url: src };
        a.addEventListener("loadedmetadata", onLoaded, { once: true });
        a.addEventListener("error", onErr, { once: true });
        if (paused) {
          // session restore (was paused): arm the source at the saved position,
          // but never autoplay and never run the stall timer — the mini player
          // simply shows the song, one tap from continuing
          a.src = src;
          setBuffering(false);
          setIsPlaying(false);
          return;
        }
        if (directTimerRef.current) clearTimeout(directTimerRef.current);
        directTimerRef.current = setTimeout(flipToEmbed, 4000);
        a.src = src;
        a.play().catch((err: unknown) => {
          if (pauseOnDenied && (err as DOMException | undefined)?.name === "NotAllowedError") {
            // autoplay policy denied the fresh page — don't PARK the song: the
            // embed continues at the same second (muted if it must; the first tap
            // restores sound) so the counter never freezes on a refresh
            flipToEmbed();
            return;
          }
          /* autoplay rejection or network error → error/timeout path handles it */
        });
      };

      // Runtime split (api.ts's contract):
      //  - WEB: a browser cannot talk to youtubei in-process — music.youtube.com
      //    sends no CORS headers, so every Echo-chain fetch dies with TypeError
      //    "Failed to fetch" (the crash the preview showed). The same-origin
      //    server proxy /api/audio runs the identical chain server-side and
      //    streams its result; the embed engine stays the last resort.
      //  - NATIVE: CapacitorHttp patches fetch to native HTTP — no CORS. The
      //    Echo chain runs in-process and mints the URL from THIS device's IP,
      //    so the <audio> element plays googlevideo directly (no proxy hop).
      // A resolve deadline keeps a worst-case gated chain from stalling on
      // buffer; on a mid-load refusal (native) we re-resolve ONCE.
      let settled = false;
      let retried = false;
      // true when the armed src came from the session save (a pre-reload URL) —
      // such a URL is allowed ONE fresh re-resolve on web too before the embed
      const armedFromSaved = Boolean(opts?.directUrl);
      const isLive = () => !settled && directLoadSeqRef.current === mySeq && engineRef.current === "direct";
      const deadline = setTimeout(() => {
        if (isLive()) {
          settled = true;
          flipToEmbed();
        }
      }, 8000);
      const armDirect = (src: string, onErr: () => void) => {
        if (directLoadSeqRef.current !== mySeq) return;
        clearTimeout(deadline);
        arm(src, onErr);
      };
      // Terminal fallback for BOTH runtimes is the embed engine (flipToEmbed
      // continues a restored PLAYING session at its second; it only HOLDS a
      // restored-paused one).
      const onErrDirect = () => {
        if (directLoadSeqRef.current !== mySeq) return;
        if (retried) return flipToEmbed();
        // one re-resolve, then the embed: NATIVE re-mints from this device's IP;
        // WEB retries the proxy only when the FAILED arm was a SAVED session URL
        // (a fresh proxy failure is terminal — CORS forbids the in-process chain)
        if (!armedFromSaved && !IS_NATIVE) return flipToEmbed();
        retried = true;
        void (async () => {
          try {
            if (IS_NATIVE) {
              await invalidateNativeAudio(track.id);
              const again = await resolveNativeAudio(track.id, track.title, track.artist, track.duration);
              if (directLoadSeqRef.current !== mySeq || engineRef.current !== "direct") return;
              if (again) return armDirect(again.url, onErrDirect);
            } else {
              armDirect(audioUrlFor(track.id, track.title, track.artist, track.duration), onErrDirect);
              return;
            }
          } catch {
            /* re-resolve refused — embed takes over */
          }
          flipToEmbed();
        })();
      };
      void (async () => {
        try {
          if (opts?.directUrl) {
            // INSTANT CONTINUE (refresh / cold start): re-arm the exact stream URL
            // that was live before the page went away — playback restarts in well
            // under a second instead of paying a fresh resolve. An expired URL
            // falls into onErrDirect's one-shot re-resolve.
            settled = true;
            armDirect(opts.directUrl, onErrDirect);
            return;
          }
          if (!IS_NATIVE) {
            // WEB: the proxy IS the resolve path (CORS forbids the in-process chain)
            settled = true;
            armDirect(audioUrlFor(track.id, track.title, track.artist, track.duration), onErrDirect);
            return;
          }
          const stream = await resolveNativeAudio(track.id, track.title, track.artist, track.duration);
          if (!isLive()) return; // superseded, or the deadline already flipped to embed
          settled = true;
          if (!stream) return flipToEmbed();
          armDirect(stream.url, onErrDirect);
        } catch {
          // resolve must never take the app down — embed engine (or hold) takes over
          if (isLive()) {
            settled = true;
            flipToEmbed();
          }
        }
      })();
    },
    [getAudio, embedPlay, stopSim, setEngineBoth, setProgressExact]
  );

  /** generation token — a superseded async load (old song's id-swap search landing late)
   *  must never start audio: the user already tapped a different song. */
  const loadSeqRef = useRef(0);
  const loadAndPlay = useCallback(
    (track: Track) => {
      const mySeq = ++loadSeqRef.current;
      ytEmbed.pause(); // stop any previous embed audio before switching
      void (async () => {
        // mock-catalog ids aren't playable — swap in the real videoId (originals-only search).
        // Pick by RELEVANCE, not just position: search results lead with whatever is trending
        // (a query for "Kalaavathi" can surface "Inkem Inkem" first) — prefer candidates whose
        // title tokens match the seed title and whose length is close to it, so the song that
        // plays is the song the user tapped.
        let t = track;
        if (!VIDEO_ID_RE.test(t.id)) {
          try {
            const res = await searchApi(`${t.title} ${t.artist.split(",")[0]} song`);
            if (mySeq !== loadSeqRef.current) return; // superseded mid-search — abandon
            const seedToks = t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
            const score = (x: Track): number => {
              const ti = x.title.toLowerCase();
              const hits = seedToks.filter((w) => ti.includes(w)).length;
              const durOk = t.duration > 30 && Math.abs(x.duration - t.duration) <= 90 ? 1 : 0;
              return hits * 2 + durOk;
            };
            const pick = res
              .filter((x) => x.duration >= 45 && !JUNK_RE.test(x.title))
              .sort((a, b) => score(b) - score(a))[0] ?? res[0];
            if (pick && VIDEO_ID_RE.test(pick.id)) {
              // keep the SHOWN total constant for the whole track: the catalog duration
              // stays on screen unless it is unknown/implausible (≤30s). The search
              // record's length must never silently rewrite the total mid-track
              // (the 4:50 → 4:42 class of jumps) — genuine corrections belong
              // exclusively to the engine truth-sync (>15% off / preview caps).
              t = { ...t, id: pick.id, duration: t.duration > 30 ? t.duration : pick.duration || t.duration };
              setQueue((q) => q.map((x) => (x.id === track.id ? { ...x, id: t.id, duration: t.duration } : x)));
            }
          } catch {
            /* keep mock id — engines will handle/fallback */
          }
        }
        if (mySeq !== loadSeqRef.current) return; // superseded — never play a stale song
        loadedIdRef.current = t.id;
        // log to listening history (drives the personalized home feed) — real id when resolved
        recordPlay({ id: t.id, title: t.title, artist: t.artist, cover: t.cover });
        loadDirect(t);
      })();
    },
    [embedPlay, loadDirect]
  );

  // ── radio (autoplay layer) ───────────────────────────────────────────────────
  /**
   * Append fresh autoplay tracks. THE RELATION RULE (YTM parity): the seed is the
   * song you are HEARING right now — not the queue tail — so every block the queue
   * grows stays in the playing song's world (language, era, scene). The active
   * radioMode (queue chips) re-ranks/blends that Mix before it lands.
   */
  const extendRadio = useCallback(async (): Promise<boolean> => {
    if (radioLoadingRef.current) {
      // a fetch is in flight — wait for it to settle so an end-of-queue advance() can judge
      // the (possibly grown) queue; pendingRadioRef still re-runs afterwards for chip taps
      pendingRadioRef.current = true;
      await radioInFlightRef.current?.catch(() => {});
      return false;
    }
    const q = queueRef.current;
    const cur = q[queueIndexRef.current];
    const tail = q[q.length - 1];
    const seedTrack = [cur, tail].find((t): t is QTrack => !!t && VIDEO_ID_RE.test(t.id));
    if (!seedTrack) return false;
    const mode = radioModeRef.current;
    const key = `${seedTrack.id}|${mode}`;
    if (radioTriedRef.current.has(key)) return false;
    radioTriedRef.current.add(key);
    const epoch = radioEpochRef.current; // chips/context switching invalidate stale appends
    radioLoadingRef.current = true;
    setRadioLoading(true);
    const run = (async () => {
      try {
        let pool: Track[] = [];
        try {
          pool = await radioApi(seedTrack.id, { title: seedTrack.title, artist: seedTrack.artist });
        } catch {
          pool = []; // Mix endpoint hard-down (5xx / timeout) — the search fallback below answers
        }
        let ranked = pool;
        if (pool.length > 0) {
          const shaped = await shapeForMode(mode, pool, seedTrack);
          ranked = shaped.length > 0 ? shaped : pool; // a flavor that yields nothing must never kill playback
        }
        const haveBases = new Set(q.map((x) => baseTitle(x.title))); // blocks the same song in another language
        const build = (src: Track[]) =>
          relateBlock(seedTrack, src)
            .filter((t) => {
              if (t.id === seedTrack.id || q.some((x) => x.id === t.id)) return false;
              const tb = baseTitle(t.title);
              return !haveBases.has(tb);
            })
            .slice(0, 15)
            .map((t) => ({ ...t, uid: `r:${t.id}:${uidSeqRef.current++}`, layer: "radio" as const }));
        let add = build(ranked);
        if (add.length === 0) {
          // AUTOPLAY GUARANTEE (client net): the Mix endpoint is the most-gated InnerTube
          // surface — when it 5xxes or filters to zero, rebuild the block from search
          // (radioFor has a server-side fallback; this covers the route being down too).
          const artistFirst = seedTrack.artist.split(",")[0].trim();
          const lang = detectTrackLang(seedTrack);
          const queries = [
            artistFirst.length > 2 ? `${artistFirst} songs` : "",
            lang ? `${lang.toLowerCase()} hit songs` : "",
          ].filter(Boolean);
          const settled = await Promise.allSettled(queries.map((squery) => searchApi(squery)));
          const fb: Track[] = [];
          const fbSeen = new Set<string>();
          for (const s of settled) {
            if (s.status !== "fulfilled") continue;
            for (const t of s.value) {
              if (!fbSeen.has(t.id)) {
                fbSeen.add(t.id);
                fb.push(t);
              }
            }
          }
          add = build(fb);
        }
        if (add.length === 0) {
          radioTriedRef.current.delete(key); // even search came up dry — end-of-line may retry
          return false;
        }
        setQueue((prev) => {
          if (radioEpochRef.current !== epoch) return prev; // mode/context changed mid-fetch — discard
          const have = new Set(prev.map((x) => x.id));
          const fresh = add.filter((t) => !have.has(t.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        return true;
      } catch {
        radioTriedRef.current.delete(key); // transient failure — end-of-line may retry once
        return false;
      } finally {
        radioLoadingRef.current = false;
        setRadioLoading(false);
        radioInFlightRef.current = null;
        if (pendingRadioRef.current) {
          pendingRadioRef.current = false;
          void extendRadioRef.current();
        }
      }
    })();
    radioInFlightRef.current = run;
    return run;
  }, []);

  // prefetch: start loading radio when the user is ~2 tracks from the end (YTM-style prefill).
  // current?.id is a dependency too: when loadAndPlay swaps a mock catalog id for the real
  // videoId, the queue length doesn't change — without this the radio would only seed after
  // the song ends instead of right behind it.
  useEffect(() => {
    if (!autoplay || queue.length === 0) return;
    if (queue.length - queueIndex <= 2) {
      void extendRadio();
    }
  }, [queue.length, queueIndex, autoplay, current?.id, extendRadio]);

  // ── queue navigation ─────────────────────────────────────────────────────────
  const advance = useCallback(
    async (auto = false) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      if (i < q.length - 1) {
        setQueueIndex(i + 1);
        return;
      }
      if (repeatRef.current === 1) {
        setQueueIndex(0);
        return;
      }
      // end of the line: try extending with radio (autoplay).
      // extendRadio may be BUSY (tap-radio prefills constantly at queue length 1) — the
      // call now awaits that fetch's settle, then we judge the real queue length so a
      // track-end / Next during a prefill can never strand playback on a dead song.
      if (autoplayRef.current) {
        await extendRadio().catch(() => {});
        // give the settled append a beat to commit to queueRef, then look for room ahead
        for (let k = 0; k < 10 && queueRef.current.length <= i + 1; k++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        if (queueRef.current.length > i + 1) {
          setQueueIndex(i + 1);
          return;
        }
        const grew = await extendRadio(); // genuine retry (first attempt failed transiently)
        if (grew) {
          setQueueIndex(i + 1);
          return;
        }
      }
      // nothing more to play — park on the last track (paused when auto-advanced)
      if (auto) setIsPlaying(false);
    },
    [extendRadio]
  );
  const advanceRef = useRef<(auto?: boolean) => void | Promise<void>>((_auto) => {});
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  /** One funnel for every NATURAL track end (sim tick exhaustion, direct `ended`,
   *  embed `ended`): sleep-at-track-end pauses instead of moving on; repeat-one
   *  restarts the same song in whichever engine owns it; otherwise advance. The
   *  Next button intentionally bypasses this — skipping is always allowed. */
  const trackEndRef = useRef<() => void>(() => {});

  /** Engine-aware pause — the sleep timer must reach every engine. */
  const pauseAllEngines = useCallback(() => {
    clearSimTick();
    ytEmbed.pause();
    audioRef.current?.pause();
    setIsPlaying(false);
  }, [clearSimTick]);

  const onTrackEnded = useCallback(() => {
    if (sleepTrackEndRef.current) {
      setSleepTimerState(null); // one-shot — the next natural end plays on
      pauseAllEngines();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("dhun:sleep-fired"));
      return;
    }
    if (repeatRef.current === 2) {
      // loop one — restart the very same song, wherever it is playing
      if (engineRef.current === "sim") {
        simProgressRef.current = 0;
        setProgressExact(0);
      } else if (engineRef.current === "embed") {
        ytEmbed.seek(0);
        ytEmbed.play();
      } else {
        const a = audioRef.current;
        if (a) {
          a.currentTime = 0;
          void a.play().catch(() => {});
        }
      }
      return;
    }
    void advanceRef.current(true);
  }, [pauseAllEngines, setProgressExact]);
  useEffect(() => {
    trackEndRef.current = onTrackEnded;
  }, [onTrackEnded]);

  // ── sleep timer ──────────────────────────────────────────────────────────────
  // Fires once: pauses every engine, clears itself, and lets the UI toast why.
  const setSleepTimer = useCallback((t: SleepTimerInput) => {
    if (t === null) setSleepTimerState(null);
    else if (t === "track") setSleepTimerState({ mode: "track" });
    else {
      const minutes = Math.min(600, Math.max(1, Math.round(t.minutes)));
      setSleepTimerState({ mode: "time", endsAt: Date.now() + minutes * 60000, minutes });
    }
  }, []);

  useEffect(() => {
    if (!sleepTimer || sleepTimer.mode !== "time") return;
    const id = setTimeout(() => {
      setSleepTimerState(null);
      if (isPlayingRef.current) pauseAllEngines();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("dhun:sleep-fired"));
    }, Math.max(0, sleepTimer.endsAt - Date.now()));
    return () => clearTimeout(id);
  }, [sleepTimer, pauseAllEngines]);

  const playTrack = useCallback(
    (t: Track, context?: Track[], label?: string) => {
      // user gesture path — open the MediaSession anchor while the tap's
      // activation is still fresh (the OS card needs a playing element in the
      // top document; see mediaSession.ts)
      ensureAnchorAudio();
      const src = context && context.length > 0 ? context : [t];
      let q: QTrack[] = src.map((x, i) => ({ ...x, uid: `c:${x.id}:${i}`, layer: "context" as const }));
      const idx = Math.max(0, q.findIndex((x) => x.id === t.id));
      const clicked = q[idx] ?? { ...t, uid: `c:${t.id}:0`, layer: "context" as const };
      if (shuffleRef.current) {
        // clicked track plays now; the rest shuffled artist-spaced
        const rest = q.filter((x) => x.uid !== clicked.uid);
        q = [clicked, ...balancedShuffle(rest)];
        setQueueIndex(0);
      } else {
        setQueueIndex(idx);
      }
      savedOrderRef.current = null;
      radioTriedRef.current = new Set();
      radioEpochRef.current++; // a new context invalidates any in-flight radio append
      setQueue(q);
      setPlayingFrom(label ?? null);
      pendingRef.current = true;
      loadAndPlay(clicked);
    },
    [loadAndPlay]
  );

  /**
   * YTM single-tap semantics (the relation contract): the tapped song plays NOW and its
   * radio — seeded from THAT song, led by its artist/composer — fills the queue behind it
   * ("Playing from ⟨song⟩ radio"). This is how every non-list surface plays: search
   * results, recommendation shelves, charts. A one-long queue trips the prefill effect,
   * which seeds the radio from the tapped song automatically.
   */
  const playRadio = useCallback(
    (t: Track, label?: string) => {
      playTrack(t, undefined, label ?? "Song radio");
    },
    [playTrack]
  );

  // react to queue index changes (next/prev/auto-advance/jump)
  useEffect(() => {
    if (!current) return;
    // skip re-loading when playTrack already handled it
    if (pendingRef.current) {
      pendingRef.current = false;
      return;
    }
    // skip when the resolved-id swap (mock → real videoId) triggered this render
    if (current.id === loadedIdRef.current) return;
    // defer out of the effect body (react-compiler: no sync setState in effects)
    const id = setTimeout(() => loadAndPlay(current), 0);
    return () => clearTimeout(id);
  }, [queueIndex, current?.id, loadAndPlay]);

  // audio element event wiring (progress / ended / buffering — direct engine only)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      // readyState gate: before metadata lands (HAVE_METADATA) currentTime is a
      // meaningless 0 — a load that dies (502/reset) still emits a trailing
      // timeupdate, which would clobber a restored session's displayed second
      if (engineRef.current === "direct" && a.readyState >= 1) tickProgress(a.currentTime);
    };
    const onEnded = () => {
      if (engineRef.current === "direct") trackEndRef.current();
    };
    const onWaiting = () => {
      if (engineRef.current === "direct") setBuffering(true);
    };
    const onPlaying = () => {
      if (engineRef.current === "direct") {
        failStreakRef.current = 0; // audio is flowing — the failure chain is over
        setBuffering(false);
        stopSim();
      }
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnded);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("playing", onPlaying);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("playing", onPlaying);
    };
  }, [stopSim, tickProgress]);

  const togglePlay = useCallback(() => {
    // resume may come from the OS card — same gesture contract as playTrack
    ensureAnchorAudio();
    if (engineRef.current === "sim") {
      setIsPlaying((p) => {
        const n = !p;
        if (n) startSim(simProgressRef.current);
        else clearSimTick();
        return n;
      });
      return;
    }
    if (engineRef.current === "embed") {
      const st = ytEmbed.getState();
      if (st === "playing") ytEmbed.pause();
      else ytEmbed.play();
      return;
    }
    const a = getAudio();
    if (a.error) {
      // dead element (failed load / restored session on a gated network) — a.play()
      // on it is a silent no-op forever; resolve a fresh stream instead
      const cur = currentRef.current;
      if (cur) {
        loadDirect(cur);
        return;
      }
    }
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, [getAudio, startSim, clearSimTick, loadDirect]);

  // reflect audio play/pause into isPlaying (direct engine)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => {
      if (engineRef.current === "direct") setIsPlaying(true);
    };
    const onPause = () => {
      if (engineRef.current === "direct") setIsPlaying(false);
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  const next = useCallback(() => {
    void advanceRef.current(false);
  }, []);

  const prev = useCallback(() => {
    if (engineRef.current === "sim") {
      simProgressRef.current = 0;
      setProgressExact(0);
      return;
    }
    if (engineRef.current === "embed") {
      if (ytEmbed.getTime() > 4) {
        ytEmbed.seek(0);
        return;
      }
    } else if (audioRef.current && audioRef.current.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }
    const i = queueIndexRef.current;
    if (i > 0) setQueueIndex(i - 1);
    else if (repeatRef.current === 1) setQueueIndex(0);
  }, [setProgressExact]);

  const seek = useCallback(
    (sec: number) => {
      if (engineRef.current === "sim") {
        simProgressRef.current = sec;
        setProgressExact(sec);
        return;
      }
      if (engineRef.current === "embed") {
        ytEmbed.seek(sec);
        setProgressExact(sec);
        return;
      }
      const a = getAudio();
      if (a.duration && Number.isFinite(a.duration)) a.currentTime = sec;
    },
    [getAudio, setProgressExact]
  );

  const setVolume = useCallback(
    (v: number) => {
      setVolumeState(v);
      volumeRef.current = v;
      try {
        localStorage.setItem("dhun.volume", String(v));
      } catch {
        /* private mode */
      }
      const a = getAudio();
      a.volume = v;
      ytEmbed.setVolume(v);
      // volume slider is a user gesture — recover from a muted autoplay naturally
      ytEmbed.unmuteNow();
    },
    [getAudio]
  );

  /** explicit recovery from the muted-autoplay fallback ("tap for sound" pill) */
  const restoreSound = useCallback(() => {
    ytEmbed.userGesture();
    ensureAnchorAudio(); // the tap is a gesture — (re)open the session heartbeat
    setSoundBlocked(false);
  }, []);

  // ── OS media session (lock screen / notification card) ─────────────────────
  // Declaring Wave's session from the top document gives clean metadata + YTM-style
  // transport controls + a live scrubber. Two things make the OS actually SHOW it:
  //  1. the silent anchor <audio> (ensureAnchorAudio — started in the tap paths) so
  //     the top document owns playing media instead of borrowing the iframe's;
  //  2. bumpAnchorFocus on every embed "playing" so the iframe's own session
  //     can't out-rank ours on the card. All guards live inside mediaSession.ts —
  //     playback never depends on any of it.
  const readPosition = useCallback(() => {
    if (engineRef.current === "sim") return simProgressRef.current;
    if (engineRef.current === "embed") return ytEmbed.getTime();
    return audioRef.current?.currentTime ?? 0;
  }, []);

  // ── playback session persistence (refresh + cold start) ────────────────────
  // A refresh (or relaunch) must never lose the MOMENT or the FLOW: queue,
  // exact position, the live stream URL and whether music was playing are saved
  // continuously and restored on load. A session that was PLAYING continues
  // playing — the reload's downtime is folded into the resume position (capped)
  // so the counter picks up AHEAD of where the refresh caught it, and a browser
  // that denies sound falls back to the embed's muted autoplay (the first tap
  // restores audio) instead of parking the song. Only a session that was PAUSED
  // returns paused, still holding its exact second.
  const SESSION_KEY = "dhun.session";
  const sessionSave = useCallback(() => {
    const cur = currentRef.current;
    const q = queueRef.current;
    if (!cur || q.length === 0) return;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          v: 1,
          at: Date.now(),
          queue: q.slice(0, 300),
          index: queueIndexRef.current,
          playingFrom: playingFromRef.current,
          position: readPosition() || shownSecRef.current,
          playing: isPlayingRef.current,
          // the exact live stream URL of the CURRENT track (direct engine only,
          // guarded by track id) — restore re-arms it instantly instead of
          // paying a fresh resolve, so the song comes back without a gap
          streamUrl:
            engineRef.current === "direct" && streamUrlRef.current?.id === cur.id
              ? streamUrlRef.current.url
              : null,
        })
      );
    } catch {
      /* private mode / quota — playback never depends on the session */
    }
  }, [readPosition]);

  // keep the playingFrom mirror current for the session payload
  useEffect(() => {
    playingFromRef.current = playingFrom;
  }, [playingFrom]);

  // save triggers: a 5s heartbeat while playing + the moment the page hides
  useEffect(() => {
    const beat = setInterval(sessionSave, 5000);
    const onHide = () => {
      if (document.visibilityState === "hidden") sessionSave();
    };
    window.addEventListener("pagehide", sessionSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", sessionSave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [sessionSave]);

  // restore — runs once per page load, straight into the direct engine
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let s: { v?: number; at?: number; queue?: QTrack[]; index?: number; playingFrom?: string | null; position?: number; playing?: boolean; streamUrl?: unknown } | null = null;
    try {
      s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    } catch {
      s = null;
    }
    const q = s?.queue;
    if (!s || s.v !== 1 || !Array.isArray(q) || q.length === 0) return;
    const idx = Math.min(Math.max(0, Math.floor(s.index ?? 0)), q.length - 1);
    const t = q[idx];
    if (!t?.id) return;
    const pos = Math.max(0, Number(s.position) || 0);
    // THE FLOW RULE (user request): a refresh must never stop, rewind or restart
    // the song — the counter keeps advancing as if the audio never died. The
    // wall-clock time since the last save is folded into the resume position
    // (capped), so the reload's downtime is swallowed: the song comes back
    // AHEAD of where the refresh caught it. Past the cap (the app sat closed
    // for a while) it continues from the exact saved second instead of
    // skipping minutes.
    const GAP_LIMIT_S = 30;
    const elapsed = s.playing && s.at ? (Date.now() - Number(s.at)) / 1000 : 0;
    const gap = elapsed > 0.5 && elapsed < GAP_LIMIT_S ? Math.floor(elapsed) : 0;
    const resumeAt = pos + gap;
    const savedUrl = typeof s.streamUrl === "string" && s.streamUrl.length > 0 ? s.streamUrl : undefined;
    // the queue-index effect must not re-fire loadAndPlay over the restore
    pendingRef.current = true;
    loadedIdRef.current = t.id;
    setQueue(q);
    setQueueIndex(idx);
    setPlayingFrom(s.playingFrom ?? null);
    if (s.playing) loadDirect(t, { startAt: resumeAt, pauseOnDenied: true, restored: true, directUrl: savedUrl });
    else loadDirect(t, { startAt: pos, paused: true, restored: true, directUrl: savedUrl });
    // loadDirect re-anchors progress to 0 — restore the position AFTER it
    // (the element itself re-seeks on loadedmetadata; this fixes the DISPLAY)
    setProgressExact(s.playing ? resumeAt : pos);
  }, []);

  const readDuration = useCallback(() => {
    if (engineRef.current === "embed") {
      const d = ytEmbed.getDuration();
      if (d > 0) return d;
    }
    return currentRef.current?.duration ?? 0;
  }, []);

  // handlers once at mount — closures read refs, so they stay current across engines
  useEffect(() => {
    initMediaSession({
      play: () => {
        if (!isPlayingRef.current) togglePlay();
      },
      pause: () => {
        if (isPlayingRef.current) togglePlay();
      },
      next,
      prev,
      seek,
      position: readPosition,
      duration: readDuration,
    });
    // APK notification/lock-screen card: MediaPlaybackService evaluates
    // window.__waveMediaAction(action) for its prev/play-pause/next buttons —
    // same guarded semantics as the MediaSession handlers above.
    const w = window as unknown as { __waveMediaAction?: (action: string, pos?: number) => void };
    w.__waveMediaAction = (action: string, pos?: number) => {
      try {
        if (action === "play") {
          if (!isPlayingRef.current) togglePlay();
        } else if (action === "pause") {
          if (isPlayingRef.current) togglePlay();
        } else if (action === "next") {
          next();
        } else if (action === "prev") {
          prev();
        } else if (action === "seek") {
          // card seek bar / scrub — pos arrives in SECONDS from the service
          if (typeof pos === "number" && Number.isFinite(pos) && pos >= 0) seek(pos);
        }
      } catch {
        /* a dead card button must never crash the player */
      }
    };
    return () => {
      delete w.__waveMediaAction;
      clearMediaSession();
    };
  }, [togglePlay, next, prev, seek, readPosition, readDuration]);

  // card content follows the queue (id in deps: the mock→videoId swap re-syncs artwork).
  // The album line doubles as the queue-mode readout: the MediaSession API offers no
  // shuffle/repeat actions (the OS renders only fixed transport buttons), so at least
  // the lock-screen card SHOWS the active mode — and prev/next already obey it (refs).
  const modeHint = [shuffle ? "Shuffle on" : "", repeat === 1 ? "Loop all" : "", repeat === 2 ? "Loop one" : ""]
    .filter(Boolean)
    .join(" · ");
  // track-change detector: the card's seek bar must restart from 0 on a NEW
  // song (the service keeps extrapolating the old position otherwise), but a
  // mid-song re-push (shuffle/repeat toggle) must NOT rewind it
  const nativeCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    const idChanged = !!current && nativeCardIdRef.current !== current.id;
    nativeCardIdRef.current = current?.id ?? null;
    syncTrackMetadata(
      current
        ? {
            title: current.title,
            artist: current.artist,
            album: [(current.album || current.movie || "").trim(), modeHint].filter(Boolean).join(" · "),
            movie: current.movie,
            cover: current.cover,
            id: current.id,
          }
        : null
    );
    // APK card mirrors the same content (null tears the service + card down)
    notifyNativeMedia(
      current
        ? {
            title: current.title,
            artist: current.artist,
            album: [(current.album || current.movie || "").trim(), modeHint].filter(Boolean).join(" · "),
            cover: current.cover,
            playing: isPlayingRef.current,
            duration: current.duration > 0 ? current.duration : undefined,
            position: idChanged ? 0 : undefined,
          }
        : null
    );
  }, [current?.id, current?.title, current?.artist, current?.album, current?.movie, current?.cover, modeHint]);

  // mirror isPlaying — a stale state renders a dead ⏸/▶ button
  useEffect(() => {
    setPlaybackState(isPlaying ? "playing" : "paused");
    // the anchor is the session's heartbeat: a real (silent) playing element in
    // the top document is what makes the OS show Wave's card at all — and keeps
    // it alive while the engines' sound comes from the iframe or nowhere (sim)
    setAnchorPlaying(isPlaying);
    // metadata pushed while the session was still inactive can be dropped —
    // re-assert the card content the moment playback goes live
    if (isPlaying) reassertMetadata();
    // snap the notification scrubber to truth on every play/pause transition
    pushPositionState(readPosition(), readDuration(), true);
    // APK card: flip its ▶/⏸ button (and arm the service on first play)
    notifyNativeMedia(
      current
        ? {
            title: current.title,
            artist: current.artist,
            album: [(current.album || current.movie || "").trim(), modeHint].filter(Boolean).join(" · "),
            cover: current.cover,
            playing: isPlaying,
            // exact seek-bar state at every play/pause transition — readDuration
            // falls back to the embed's duration when the track row lacks one
            position: readPosition(),
            duration: readDuration() > 0 ? readDuration() : undefined,
          }
        : null
    );
  }, [isPlaying, readPosition, readDuration, current, modeHint]);

  // ~1Hz scrubber sync while progress ticks (500ms embed poll / timeupdate / sim 1s)
  const nativeResyncTickRef = useRef(0);
  useEffect(() => {
    pushPositionState(readPosition(), readDuration());
    // every ~10 ticks (~10s): one cheap IPC that re-glues the APK card's seek
    // bar to reality through buffering stalls and long-play drift
    nativeResyncTickRef.current += 1;
    if (isPlayingRef.current && nativeResyncTickRef.current % 10 === 0) {
      const dur = readDuration();
      if (dur > 0) notifyNativeProgress(readPosition(), dur);
    }
  }, [progress, readPosition, readDuration]);

  // ── manual queue ops (Spotify's priority layer) ─────────────────────────────
  const insertManual = useCallback((t: Track, rightAfterCurrent: boolean) => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (q.length === 0) {
      playTrack(t);
      return;
    }
    const item: QTrack = { ...t, uid: `m:${t.id}:${uidSeqRef.current++}`, layer: "manual" };
    // manual items slot in before the radio block (they jump the line over context too)
    let insertAt: number;
    if (rightAfterCurrent) insertAt = i + 1;
    else {
      const r = q.findIndex((x) => x.layer === "radio");
      insertAt = r === -1 ? q.length : r;
    }
    const nq = [...q.slice(0, insertAt), item, ...q.slice(insertAt)];
    setQueue(nq);
    // keep the saved (unshuffled) order in sync so shuffle-off restore stays correct
    if (savedOrderRef.current) {
      const s = savedOrderRef.current;
      const has = s.some((x) => x.id === t.id);
      if (!has) savedOrderRef.current = [...s, item];
    }
  }, [playTrack]);

  const addToQueue = useCallback((t: Track) => insertManual(t, false), [insertManual]);
  const playNext = useCallback((t: Track) => insertManual(t, true), [insertManual]);

  const removeFromQueue = useCallback((uid: string) => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    const idx = q.findIndex((x) => x.uid === uid);
    if (idx <= i) return; // only upcoming items are removable
    setQueue(q.filter((x) => x.uid !== uid));
    if (savedOrderRef.current) savedOrderRef.current = savedOrderRef.current.filter((x) => x.uid !== uid);
  }, []);

  const jumpTo = useCallback(
    (uid: string) => {
      const q = queueRef.current;
      const idx = q.findIndex((x) => x.uid === uid);
      if (idx === -1) return;
      if (idx === queueIndexRef.current) return;
      setQueueIndex(idx);
    },
    []
  );

  // ── queue surgery (drag reorder / clear / undo / start radio) ───────────────
  /** YTM-style flat reorder: everything after the current track is user-arrangeable. */
  const reorderUpcoming = useCallback((next: QTrack[]) => {
    const i = queueIndexRef.current;
    setQueue((prev) => [...prev.slice(0, i + 1), ...next]);
  }, []);

  /** Spotify's "Clear queue" — drops manual rows only; context + radio stay intact. */
  const clearManualQueue = useCallback(() => {
    const i = queueIndexRef.current;
    setQueue((prev) => prev.filter((x, idx) => idx <= i || x.layer !== "manual"));
  }, []);

  /** Undo helper — puts a removed item back at its exact old position. */
  const reinsertQueueItem = useCallback((item: QTrack, index: number) => {
    setQueue((prev) => {
      const i = queueIndexRef.current;
      if (index <= i || prev.some((x) => x.uid === item.uid)) return prev;
      return [...prev.slice(0, index), item, ...prev.slice(index)];
    });
  }, []);

  /**
   * YTM's "Start radio":
   *  - track lives in the upcoming queue → splice a fresh radio right after that row
   *  - track is the current one → splice right after it
   *  - track isn't queued (or has a mock id / a fetch is busy) → play it now via the
   *    single-tap radio path; the prefill seeds its radio behind it
   */
  const startRadio = useCallback(
    (t: Track, uid?: string) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      const rowIdx = uid !== undefined ? q.findIndex((x) => x.uid === uid) : q.findIndex((x) => x.id === t.id);
      const inQueue = rowIdx >= i; // upcoming row or the current one
      if (!inQueue || !VIDEO_ID_RE.test(t.id) || radioLoadingRef.current) {
        playRadio(t, "Song radio");
        return;
      }
      void (async () => {
        radioLoadingRef.current = true;
        setRadioLoading(true);
        const run = (async (): Promise<boolean> => {
          try {
            const tracks = await radioApi(t.id, { title: t.title, artist: t.artist });
            const exclude = new Set(queueRef.current.map((x) => x.id));
            const add = tracks
              .filter((x) => !exclude.has(x.id) && x.id !== t.id)
              .slice(0, 30)
              .map((x) => ({ ...x, uid: `r:${x.id}:${uidSeqRef.current++}`, layer: "radio" as const }));
            if (add.length === 0) return false;
            if (inQueue) {
              // splice right after the row (falls back to right after current if the row vanished)
              setQueue((prev) => {
                let at = uid !== undefined ? prev.findIndex((x) => x.uid === uid) : prev.findIndex((x) => x.id === t.id);
                if (at < queueIndexRef.current) at = queueIndexRef.current;
                return [...prev.slice(0, at + 1), ...add, ...prev.slice(at + 1)];
              });
            }
            return true;
          } catch {
            return false; // radio fetch failed — queue stays as it was
          } finally {
            radioLoadingRef.current = false;
            setRadioLoading(false);
            radioInFlightRef.current = null;
          }
        })();
        radioInFlightRef.current = run;
        await run;
      })();
    },
    [playRadio]
  );

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    const q = queueRef.current;
    const i = queueIndexRef.current;
    const cur = q[i];
    shuffleRef.current = on;
    setShuffle(on);
    if (!cur) return;
    if (on) {
      // save the upcoming non-manual order for restore; manual block keeps its order
      const upcoming = q.slice(i + 1);
      const manual = upcoming.filter((x) => x.layer === "manual");
      const rest = upcoming.filter((x) => x.layer !== "manual");
      savedOrderRef.current = rest;
      setQueue([...q.slice(0, i), cur, ...manual, ...balancedShuffle(rest)]);
    } else {
      const before = q.slice(0, i);
      const manual = q.slice(i + 1).filter((x) => x.layer === "manual");
      const saved = savedOrderRef.current ?? [];
      const savedIds = new Set(saved.map((x) => x.uid));
      // radio tracks appended while shuffled (not in the saved block) stay at the end
      const extra = q.slice(i + 1).filter((x) => x.layer === "radio" && !savedIds.has(x.uid));
      setQueue([...before, cur, ...manual, ...saved, ...extra]);
      savedOrderRef.current = null;
    }
  }, []);

  const cycleRepeat = useCallback(() => setRepeat((r) => ((r + 1) % 3) as RepeatMode), []);

  const toggleAutoplay = useCallback(() => {
    setAutoplay((a) => {
      const n = !a;
      try {
        localStorage.setItem("dhun.autoplay", n ? "on" : "off");
      } catch {}
      return n;
    });
  }, []);

  /** YTM queue chips — retune the autoplay flavor and regenerate its upcoming block. */
  const setRadioMode = useCallback(
    (m: RadioMode) => {
      if (m === radioModeRef.current) return;
      radioModeRef.current = m;
      setRadioModeState(m);
      try {
        localStorage.setItem("dhun.radioMode", m);
      } catch {}
      const i = queueIndexRef.current;
      radioEpochRef.current++; // in-flight appends from the old flavor are discarded
      setQueue((prev) => prev.filter((x, idx) => idx <= i || x.layer !== "radio"));
      radioTriedRef.current = new Set();
      // always pull a fresh block in the new flavor right away — the epoch + pending-retry
      // make this safe even when another radio fetch is still in flight
      if (autoplayRef.current) void extendRadio();
    },
    [extendRadio]
  );

  const toggleLike = useCallback((id: string, t?: Track) => {
    setLikedIds((s) => {
      const n = new Set(s);
      const liking = !n.has(id);
      if (liking) n.add(id);
      else n.delete(id);
      try {
        localStorage.setItem("dhun.liked", JSON.stringify([...n]));
      } catch {}
      // keep the full-track snapshot store in sync (drives the Liked view)
      setLikedTracks((prev) => {
        const without = prev.filter((x) => x.id !== id);
        const next = liking ? (t ? [{ ...t }, ...without] : without) : without;
        try {
          localStorage.setItem("dhun.likedTracks", JSON.stringify(next.slice(0, 500)));
        } catch {}
        return next;
      });
      return n;
    });
  }, []);

  // restore likes + their snapshots after mount — post-hydration update, never a first-render mismatch
  useEffect(() => {
    try {
      const arr = JSON.parse(localStorage.getItem("dhun.liked") ?? "[]");
      if (Array.isArray(arr)) setLikedIds(new Set(arr.filter((x): x is string => typeof x === "string")));
      const lt = JSON.parse(localStorage.getItem("dhun.likedTracks") ?? "[]");
      if (Array.isArray(lt)) {
        setLikedTracks(lt.filter((x: unknown): x is Track => !!x && typeof x === "object" && typeof (x as Track).id === "string"));
      }
    } catch {
      /* fresh install */
    }
  }, []);

  // cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      clearSimTick();
      if (pollRef.current) clearInterval(pollRef.current);
      if (directTimerRef.current) clearTimeout(directTimerRef.current);
      if (embedWatchdogRef.current) clearTimeout(embedWatchdogRef.current);
      ytEmbed.pause();
    };
  }, [clearSimTick]);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      queue,
      queueIndex,
      playingFrom,
      autoplay,
      radioMode,
      setRadioMode,
      radioLoading,
      isPlaying,
      progress,
      expanded,
      shuffle,
      repeat,
      sleepTimer,
      setSleepTimer,
      volume,
      likedIds,
      likedTracks,
      engine,
      previewLimited,
      buffering,
      soundBlocked,
      playTrack,
      addToQueue,
      playNext,
      removeFromQueue,
      jumpTo,
      reorderUpcoming,
      clearManualQueue,
      reinsertQueueItem,
      startRadio,
      playRadio,
      togglePlay,
      next,
      prev,
      seek,
      setExpanded,
      toggleShuffle,
      cycleRepeat,
      toggleAutoplay,
      setVolume,
      restoreSound,
      toggleLike,
    }),
    [current, queue, queueIndex, playingFrom, autoplay, radioMode, radioLoading, isPlaying, progress, expanded, shuffle, repeat, sleepTimer, volume, likedIds, likedTracks, engine, previewLimited, buffering, soundBlocked, playTrack, addToQueue, playNext, removeFromQueue, jumpTo, reorderUpcoming, clearManualQueue, reinsertQueueItem, startRadio, playRadio, togglePlay, next, prev, seek, setExpanded, toggleShuffle, cycleRepeat, setSleepTimer, toggleAutoplay, setRadioMode, setVolume, restoreSound, toggleLike]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* hidden real-audio element (direct engine) */}
      <audio ref={audioRef as any} hidden />
      {/* hidden YouTube IFrame (embed engine) is created imperatively by ytEmbed */}
    </Ctx.Provider>
  );
}

export function usePlayer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used within PlayerProvider");
  return v;
}
