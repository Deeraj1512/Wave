/**
 * Downloads (batch 8) — save a song's real audio on-device so it plays with
 * ZERO network: airplane mode, dead zones, the whole library offline.
 *
 * Where the bytes come from (both runtimes, one code path):
 *  - WEB: the same-origin /api/audio proxy streams the chosen lane (opus high)
 *    with Content-Length → true progress.
 *  - NATIVE (APK): there is no bundled server, so the song's googlevideo URL
 *    is minted in-process (resolveNativeAudio — same chain the player uses)
 *    and fetched directly. CapacitorHttp's fetch patch routes every GET
 *    through the WebView's local interceptor (/_capacitor_http_interceptor_),
 *    which performs the request natively and hands the WebView REAL binary
 *    bytes + a ReadableStream — so streaming progress works here too.
 *    (Never POST/PUT anything binary here: only GETs ride the interceptor.)
 *
 * Where the bytes live: IndexedDB, two stores —
 *  - "audio" : id → { blob, mime } (read ONLY when the song plays)
 *  - "meta"  : id → track metadata, size, date (cheap to list for the
 *              Downloads page / Library card; never touches the blobs)
 *
 * Playback hook: the player checks getDownloadedAudio(id) FIRST when arming
 * the <audio> element — a saved song is a local blob URL: instant start, no
 * resolve, no proxy, no deadline, fully offline.
 */

import { useSyncExternalStore, useMemo } from "react";
import type { Lang, Track } from "./types";
import { audioUrlFor, browserSupportsOpus, IS_NATIVE, resolveNativeAudio } from "./api";

/** a real YouTube videoId — mock-catalog ids ("t01"-style) can't be downloaded */
const VIDEO_ID_RE = /^[\w-]{11}$/;

const DB_NAME = "wave-downloads";
const DB_VERSION = 1;
const AUDIO_STORE = "audio";
const META_STORE = "meta";

export interface DownloadMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  lang?: Lang;
  year: number;
  plays: string;
  colors: [string, string];
  cover?: string;
  /** stored blob's mime ("audio/webm" for opus, "audio/mp4" for aac) */
  mime: string;
  size: number; // bytes
  at: number; // downloadedAt epoch ms
}

interface AudioRecord {
  blob: Blob;
  mime: string;
}

// ── external store (menus/pages re-render on download state changes) ────────

let version = 0;
const listeners = new Set<() => void>();
function bump() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function downloadsVersion(): number {
  return version;
}

/** hydrated metadata (no blobs) — filled once at startup from IndexedDB */
const metasById = new Map<string, DownloadMeta>();

/** in-flight downloads → percent (menus read this live) */
const progressById = new Map<string, number>();
/** in-flight dedupe — a double tap must not start two downloads */
const inflight = new Map<string, Promise<boolean>>();

// ── IndexedDB plumbing ───────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => Promise<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const t = db.transaction(stores, mode);
    const out = await run(t);
    return await new Promise<T | null>((resolve) => {
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** load metadata at startup (never the blobs) + ask for persistent storage */
let hydrated = false;
export async function hydrateDownloads(): Promise<void> {
  if (hydrated || typeof indexedDB === "undefined") return;
  hydrated = true;
  const db = await openDb();
  if (!db) return;
  try {
    const t = db.transaction([META_STORE], "readonly");
    const all = await req<DownloadMeta[]>(t.objectStore(META_STORE).getAll());
    metasById.clear();
    for (const m of all ?? []) metasById.set(m.id, m);
    bump();
  } catch {
    /* first run — empty map is correct */
  }
  // keep saved songs from being evicted under storage pressure (best-effort)
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* not supported — fine */
  }
}
if (typeof window !== "undefined") {
  // defer out of module evaluation (hydration-safe, same pattern as Home)
  const id = setTimeout(() => void hydrateDownloads(), 0);
  void id;
}

// ── public read API ──────────────────────────────────────────────────────────

export function isDownloaded(id: string): boolean {
  return metasById.has(id);
}

/** Player hot path: the saved audio blob for a song, if one exists. */
export async function getDownloadedAudio(id: string): Promise<Blob | undefined> {
  if (!metasById.has(id)) return undefined;
  const db = await openDb();
  if (!db) return undefined;
  try {
    const t = db.transaction([AUDIO_STORE], "readonly");
    const rec = (await req<AudioRecord | undefined>(t.objectStore(AUDIO_STORE).get(id))) ?? undefined;
    return rec?.blob ?? undefined;
  } catch {
    return undefined;
  }
}

export function metaToTrack(m: DownloadMeta): Track {
  return {
    id: m.id,
    title: m.title,
    artist: m.artist,
    album: m.album,
    duration: m.duration,
    lang: m.lang,
    year: m.year,
    plays: m.plays,
    colors: m.colors,
    cover: m.cover,
  };
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** reactive per-song status for menus (TrackRow / Cards / player ⋮) */
export function useDownloadStatus(id: string): { downloaded: boolean; progress: number | null } {
  const v = useSyncExternalStore(subscribeDownloads, downloadsVersion, () => 0);
  return useMemo(
    () => ({ downloaded: metasById.has(id), progress: progressById.get(id) ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, v]
  );
}

/** reactive list for the Downloads page / Library card (metadata only) */
export function useDownloadsList(): { metas: DownloadMeta[]; totalSize: number } {
  const v = useSyncExternalStore(subscribeDownloads, downloadsVersion, () => 0);
  return useMemo(() => {
    const metas = [...metasById.values()].sort((a, b) => b.at - a.at);
    return { metas, totalSize: metas.reduce((s, m) => s + m.size, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

// ── download / remove ────────────────────────────────────────────────────────

/** percent emit — throttle so menus don't re-render on every 64 KB chunk */
let lastEmitAt = 0;
function setProgress(id: string, received: number, total: number) {
  const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
  const now = Date.now();
  if (pct === 0 || now - lastEmitAt >= 300) {
    lastEmitAt = now;
    progressById.set(id, pct);
    bump();
  }
}

/**
 * Download one song's audio and store it. Resolves true when the song is
 * saved (also when it ALREADY was). Never throws — callers toast the boolean.
 */
export function downloadTrack(track: Track): Promise<boolean> {
  if (!VIDEO_ID_RE.test(track.id)) return Promise.resolve(false);
  const existing = inflight.get(track.id);
  if (existing) return existing;
  const p = doDownload(track).finally(() => inflight.delete(track.id));
  inflight.set(track.id, p);
  return p;
}

async function doDownload(track: Track): Promise<boolean> {
  if (metasById.has(track.id)) return true;
  if (typeof fetch === "undefined" || typeof indexedDB === "undefined") return false;

  // the lane the device already plays, but always HIGH quality — a download
  // is one-time traffic, the saved copy should be the best one
  let url: string;
  if (IS_NATIVE) {
    // APK: no bundled server — mint the googlevideo URL from THIS device
    // (same chain/arm the player uses) and fetch it through the local
    // interceptor, which returns real binary bytes.
    const s = await resolveNativeAudio(track.id, track.title, track.artist, track.duration);
    if (!s?.url) return false;
    url = s.url;
  } else {
    // WEB: the same-origin proxy streams the lane directly.
    const codec: "aac" | "opus" = browserSupportsOpus() ? "opus" : "aac";
    url = audioUrlFor(track.id, track.title, track.artist, track.duration, codec, "high");
  }

  progressById.set(track.id, 0);
  bump();

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const mime = (res.headers.get("content-type") || "audio/webm").split(";")[0].trim();
    const total = Number(res.headers.get("content-length")) || 0;

    let blob: Blob;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          setProgress(track.id, received, total);
        }
      }
      blob = new Blob(chunks as unknown as BlobPart[], { type: mime });
    } else {
      // patched transports without a stream — one-shot, spinner only
      const buf = await res.arrayBuffer();
      blob = new Blob([buf], { type: mime });
    }

    // sanity gate: a real song is MBs; anything smaller is junk we must not save
    if (blob.size < 50_000) throw new Error("download too small");

    const meta: DownloadMeta = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      lang: track.lang,
      year: track.year ?? 0,
      plays: track.plays ?? "",
      colors: track.colors ?? ["#4a4a6a", "#16161c"],
      cover: track.cover,
      mime,
      size: blob.size,
      at: Date.now(),
    };

    const ok = await tx([AUDIO_STORE, META_STORE], "readwrite", async (t) => {
      t.objectStore(AUDIO_STORE).put({ blob, mime } satisfies AudioRecord, track.id);
      t.objectStore(META_STORE).put(meta, track.id);
      return true;
    });
    if (!ok) throw new Error("storage failed");

    metasById.set(track.id, meta);
    return true;
  } catch {
    return false;
  } finally {
    progressById.delete(track.id);
    bump();
  }
}

/** Delete the saved copy (Downloads page and menu "Remove download"). */
export async function removeDownload(id: string): Promise<boolean> {
  const ok = await tx([AUDIO_STORE, META_STORE], "readwrite", async (t) => {
    t.objectStore(AUDIO_STORE).delete(id);
    t.objectStore(META_STORE).delete(id);
    return true;
  });
  if (ok) metasById.delete(id);
  bump();
  return ok;
}
