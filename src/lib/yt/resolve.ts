/**
 * Stream resolver — ported from Echo Music's YTPlayerUtils.kt + InnerTubeXResolver.kt:
 *  - Echo's measured client chain (VISIONOS first: only client serving complete files)
 *  - Range-probe validation: probes the LAST byte when contentLength is known — this catches the
 *    ~1MiB preview-capped URLs of IOS/IPADOS clients that would otherwise die mid-playback.
 *    Range-less probes 403 on YTM art tracks, so the probe always carries Range.
 *  - Per-videoId client exclusion for 10 minutes after a refusal (Echo's EXCLUDE_MS).
 *  - 5h URL cache (stream URLs expire ~6h).
 */
import { STREAM_CHAIN, type InnertubeClient } from "./clients";
import { player, sessionReady } from "./innertube";

export interface ResolvedStream {
  videoId: string;
  url: string;
  client: string;
  itag: number;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
  expiresAt: number;
  preview: boolean;
}

type CacheEntry = ResolvedStream;
interface ProbeInfo {
  status: number | string;
  note?: string;
}

const URL_TTL = 5 * 60 * 60 * 1000; // 5h (googlevideo URLs live ~6h)
const EXCLUDE_MS = 10 * 60 * 1000; // Echo: 10 min per-videoId client exclusion

// ── Circuit breaker ──────────────────────────────────────────────────────────
// Hammering /player while the IP is bot-flagged only deepens the flag (learned the hard way).
// After 8 consecutive gated responses we cool down for 3 minutes and fail fast until then.
const BREAKER_THRESHOLD = 8;
const BREAKER_COOLDOWN = 3 * 60 * 1000;
let gatedStreak = 0;
let breakerOpenUntil = 0;

function noteGated() {
  gatedStreak++;
  if (gatedStreak >= BREAKER_THRESHOLD) breakerOpenUntil = Date.now() + BREAKER_COOLDOWN;
}
function noteOk() {
  gatedStreak = 0;
  breakerOpenUntil = 0;
}
export function breakerStatus() {
  return breakerOpenUntil > Date.now() ? Math.ceil((breakerOpenUntil - Date.now()) / 1000) : 0;
}

const cache = new Map<string, CacheEntry>();
const excluded = new Map<string, Map<string, number>>(); // videoId -> clientName -> until
let chainDebug: Array<{ client: string; status: string; reason?: string; formats?: number; probed?: ProbeInfo }> = [];

function isExcluded(videoId: string, clientName: string): boolean {
  const m = excluded.get(videoId);
  if (!m) return false;
  const until = m.get(clientName);
  if (until && until < Date.now()) {
    m.delete(clientName);
    return false;
  }
  return until !== undefined;
}

export function excludeClient(videoId: string, clientName: string) {
  const m = excluded.get(videoId) ?? new Map<string, number>();
  m.set(clientName, Date.now() + EXCLUDE_MS);
  excluded.set(videoId, m);
}

export function getChainDebug() {
  return chainDebug;
}

/** Pick the best audio format: audio-only, prefer m4a (universal browser support), then bitrate. */
function pickFormat(formats: Array<{ itag: number; url?: string; mimeType?: string; bitrate?: number; contentLength?: number; signatureCipher?: string; cipher?: string }>) {
  const usable = formats.filter((f) => typeof f.url === "string" && f.url.startsWith("http") && (f.mimeType ?? "").startsWith("audio/"));
  if (usable.length === 0) return undefined;
  const score = (f: (typeof usable)[0]) => {
    const isM4a = (f.mimeType ?? "").includes("mp4");
    const isOpus = (f.mimeType ?? "").includes("webm");
    // m4a itag 140 (~128kbps) plays everywhere; opus 251 slightly better quality but Safari can't
    return (isM4a ? 2_000_000 : 0) + (isOpus ? 1_000_000 : 0) + (f.bitrate ?? 0);
  };
  return usable.sort((a, b) => score(b) - score(a))[0];
}

/**
 * Probe the stream URL the way the player will consume it:
 *  - Always send Range (Range-less requests 403 on art tracks — Echo's measured table).
 *  - If contentLength is known, probe the LAST 512 bytes: detects the ~1MiB preview cap on
 *    IOS/IPADOS clients (probe inside the window would 206 for a stream that dies at 60s).
 */
async function probe(url: string, ua: string, contentLength?: number): Promise<ProbeInfo> {
  try {
    const range =
      contentLength && contentLength > 1024 * 1024
        ? `bytes=${contentLength - 512}-${contentLength - 1}`
        : "bytes=0-524287";
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Range: range },
      signal: AbortSignal.timeout(8000),
    });
    // Drain a tiny bit then cancel — we only need the status line.
    res.body?.cancel().catch(() => {});
    return { status: res.status, note: res.status === 206 ? "ranged-ok" : undefined };
  } catch (e: any) {
    // Echo's rule: IOException → treat as valid (don't cascade down the chain for network noise)
    return { status: "io", note: e?.message };
  }
}

export async function resolveStream(videoId: string, opts: { allowPreview?: boolean; forceRefresh?: boolean } = {}): Promise<ResolvedStream | null> {
  await sessionReady();
  chainDebug = [];

  if (!opts.forceRefresh) {
    const hit = cache.get(videoId);
    if (hit && hit.expiresAt > Date.now()) {
      chainDebug.push({ client: hit.client, status: "cache-hit" });
      return hit;
    }
  }

  // circuit breaker: fail fast while the IP cools down (open breaker also self-clears on success)
  const b = breakerStatus();
  if (b > 0) {
    chainDebug.push({ client: "breaker", status: `cooling ${b}s` });
    return null;
  }

  for (const c of STREAM_CHAIN) {
    if (isExcluded(videoId, c.name)) {
      chainDebug.push({ client: c.name, status: "excluded" });
      continue;
    }
    if (c.preview && !opts.allowPreview) {
      chainDebug.push({ client: c.name, status: "skip-preview" });
      continue;
    }
    const pr = await player(c, videoId);
    if (!pr.ok || pr.formats.length === 0) {
      chainDebug.push({ client: c.name, status: pr.status ?? "fail", reason: pr.reason, formats: pr.formats.length });
      // LOGIN_REQUIRED / bot-gate → exclude this client for this video for 10 min
      if (pr.status && pr.status !== "OK") {
        excludeClient(videoId, c.name);
        noteGated();
      }
      continue;
    }
    const fmt = pickFormat(pr.formats);
    if (!fmt?.url) {
      chainDebug.push({ client: c.name, status: "no-plain-url", formats: pr.formats.length });
      continue;
    }
    const probeInfo = await probe(fmt.url, c.userAgent, fmt.contentLength);
    const ok = probeInfo.status === 206 || probeInfo.status === 200 || probeInfo.status === "io";
    chainDebug.push({ client: c.name, status: pr.status ?? "fail", formats: pr.formats.length, probed: probeInfo });
    if (!ok) {
      excludeClient(videoId, c.name);
      continue;
    }
    noteOk();
    const resolved: ResolvedStream = {
      videoId,
      url: fmt.url,
      client: c.name,
      itag: fmt.itag,
      mimeType: fmt.mimeType ?? "audio/mp4",
      bitrate: fmt.bitrate,
      contentLength: fmt.contentLength,
      expiresAt: Date.now() + URL_TTL,
      preview: !!c.preview,
    };
    cache.set(videoId, resolved);
    return resolved;
  }
  return null;
}

/** Called by the audio proxy when googlevideo 403s mid-stream. */
export function invalidateStream(videoId: string, clientName?: string) {
  cache.delete(videoId);
  if (clientName) excludeClient(videoId, clientName);
}

// ── Sibling fallback ─────────────────────────────────────────────────────────
// Discovery (this project): the bot-gate on /player is PER-VIDEO, not per-content-type.
// From datacenter IPs, YTM art tracks (-Topic) are frequently gated while the SAME song's
// official music video on the label channel is not. When the requested video is gated, we
// search for siblings (same title+artist, official video) and resolve one of those instead.
// Audio is identical for the same song.

const siblingCache = new Map<string, string>(); // videoId -> sibling videoId
const siblingPreview = new Map<string, boolean>(); // videoId -> sibling only serves preview-cap URLs

async function findPlayableSibling(
  videoId: string,
  title: string,
  artist: string,
  durSec?: number
): Promise<string | null> {
  if (siblingCache.has(videoId)) return siblingCache.get(videoId)!;
  try {
    const { searchForSiblings } = await import("./search");
    const artistFirst = artist.split(",")[0].trim();
    // The real OMV ranks under "<song> official video" — verified against Kesariya.
    const queries = [`${title} official video`, `${title} ${artistFirst} song`];

    for (const q of queries) {
      const res = await searchForSiblings(q);
      // Reject harsh junk (remix/mashup/instrumental/cover — WRONG audio); tolerate lyrics-video
      // reuploads of the official recording (same audio, acceptable as last-resort fallback).
      const STRICT_JUNK = /\bremix\b|\bmashup\b|\bmix\b|\binstrumental\b|\bkaraoke\b|\bcover\b|\bslowed\b|\breverb\b|\bsped\s?up\b|\b8d\b|\bnightcore\b|\bjukebox\b|\bloom\s?lofi\b|\blofi\b/i;
      const titleTok = title.toLowerCase().replace(/\(from[^)]*\)/g, "").split(/[\s(]/)[0] ?? "";
      const candidates = res.tracks
        .filter((t) => {
          if (t.videoId === videoId) return false;
          if (STRICT_JUNK.test(t.title)) return false;
          if (t.durationSec < 45) return false;
          // duration plausibility vs requested track (±35%) when known
          if (durSec && (t.durationSec < durSec * 0.65 || t.durationSec > durSec * 1.35 + 20)) return false;
          // title should mention the song (first token) for relevance
          if (titleTok.length > 3 && !t.title.toLowerCase().includes(titleTok)) return false;
          return true;
        })
        .sort((a, b) => a.tier - b.tier || b.views - a.views)
        .slice(0, 6);
      for (const c of candidates) {
        const pr = await playerChainProbe(c.videoId);
        if (pr.ok) {
          siblingCache.set(videoId, c.videoId);
          siblingPreview.set(videoId, pr.preview);
          return c.videoId;
        }
      }
    }
  } catch {
    /* sibling search is best-effort */
  }
  return null;
}

/** Probe result: whether any client serves this video, and whether only preview-capped ones do. */
async function playerChainProbe(vid: string): Promise<{ ok: boolean; preview: boolean }> {
  // Non-preview (whole-file) clients first; preview-capped (IOS/IPADOS ~1MiB) as last resort.
  for (const c of STREAM_CHAIN) {
    if (c.preview) continue;
    const pr = await player(c, vid);
    if (!pr.ok || pr.formats.length === 0) continue;
    const fmt = pr.formats.find((f) => typeof f.url === "string" && f.url.startsWith("http") && (f.mimeType ?? "").startsWith("audio/"));
    if (!fmt?.url) continue;
    const p = await probe(fmt.url, c.userAgent, fmt.contentLength);
    if (p.status === 206 || p.status === 200 || p.status === "io") return { ok: true, preview: false };
  }
  for (const c of STREAM_CHAIN) {
    if (!c.preview) continue;
    const pr = await player(c, vid);
    if (!pr.ok || pr.formats.length === 0) continue;
    const fmt = pr.formats.find((f) => typeof f.url === "string" && f.url.startsWith("http") && (f.mimeType ?? "").startsWith("audio/"));
    if (!fmt?.url) continue;
    const p = await probe(fmt.url, c.userAgent, fmt.contentLength);
    if (p.status === 206 || p.status === 200 || p.status === "io") return { ok: true, preview: true };
  }
  return { ok: false, preview: false };
}

/**
 * Full resolution: requested video through Echo's chain; on bot-gate, fall back to a playable
 * sibling of the same song. `meta` (title/artist) enables the sibling search.
 */
export async function resolveStreamSmart(
  videoId: string,
  meta?: { title?: string; artist?: string; durationSec?: number }
): Promise<(ResolvedStream & { requestedVideoId: string; viaSibling: boolean }) | null> {
  const direct = await resolveStream(videoId, {});
  if (direct) return { ...direct, requestedVideoId: videoId, viaSibling: false };

  if (meta?.title && meta.title !== "Unknown") {
    const sib = await findPlayableSibling(videoId, meta.title, meta.artist ?? "", meta.durationSec);
    if (sib) {
      const r = await resolveStream(sib, { allowPreview: siblingPreview.get(videoId) ?? false });
      if (r) {
        // serve the sibling's URL under the REQUESTED id (audio proxy keys on requested id)
        cache.set(videoId, r);
        return { ...r, requestedVideoId: videoId, viaSibling: true };
      }
    }
  }
  return null;
}
