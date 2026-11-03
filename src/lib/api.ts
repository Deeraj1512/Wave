/**
 * Client API layer — the single swap point between the UI and the Wave backend
 * (which is Echo-Music's streaming strategy ported to our server).
 *
 * Two runtimes, one interface:
 *  - WEB  (browser / deployed site): calls hit our Next.js /api routes, which
 *    run the Echo chain server-side and proxy googlevideo (needed there because
 *    stream URLs are IP-bound to the minter — the server).
 *  - NATIVE (Android APK via Capacitor): there IS no server. The device runs
 *    the very same Echo chain in-process (src/lib/yt/* is isomorphic) and plays
 *    googlevideo URLs it minted itself — same IP, no proxy needed. Capacitor's
 *    CapacitorHttp patches fetch to native HTTP, so CORS never applies.
 */
import type { Track } from "./types";
import { colorFor } from "./data";
import { detectTrackLang } from "./langs";

/** True inside the Capacitor Android/iOS shell (APK), false in any browser. */
export const IS_NATIVE: boolean =
  typeof window !== "undefined" &&
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export interface ApiTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  views: number;
  tier: number;
  thumb?: string;
}

interface SearchResponse {
  query: string;
  tracks: ApiTrack[];
  dropped: Record<string, number>;
  attempts: string[];
  cached?: boolean;
  error?: string;
}

/**
 * Display-title cleaner for video-tier results: YTM OMV/UGC titles carry upload noise —
 * "Butta Bomma Video Song 8K | Ala Vaikunthapurramuloo | Allu Arjun | …". Keep the song
 * name, drop promo words and pipe-separated metadata. Matching/search still uses the
 * raw title (server-side); this only affects what the UI shows.
 */
function displayTitle(raw: string): string {
  let s = raw.replace(/\s*\(From[^)]*\)/i, "").trim();
  if (s.includes("|")) {
    const head = s.split("|")[0].trim();
    const PROMO = /\b(video\s?song|full\s?song|full\s?video|lyrical\s?video|lyrical|official\s?(?:video|audio|song)|audio\s?song|4k|8k|hd)\b/gi;
    if (head.length >= 3) {
      const cleaned = head.replace(PROMO, "").replace(/\s{2,}/g, " ").trim();
      if (cleaned.length >= 3) s = cleaned;
    }
  }
  // uploaders decorate titles ("✷Raavana Mavandaa") — strip leading non-word symbols
  s = s.replace(/^[^\p{L}\p{N}"'(\[]+/u, "").trim();
  // YTM ATV titles carry language markers — noise in the UI (we show lang separately)
  s = s.replace(/\s*\((?:tamil|telugu|hindi|malayalam|kannada|punjabi|bengali|marathi|bhojpuri)\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
  // "(Version, 1)" style ATV duplicates marker
  s = s.replace(/\s*\((?:version|ver\.?|deluxe|updated),?\s*\w{0,6}\)?\s*$/i, "").trim();
  // "ROOH - Hindi Indie Acoustic Love Song" — self-promo genre suffix after a dash
  s = s.replace(/\s*[–—-]\s*(?:hindi|punjabi|tamil|telugu|malayalam|kannada)?\s*(?:indie|acoustic|unplugged|lofi|sad|love|romantic|melody)?\s*(?:indie|acoustic|unplugged|lofi|sad|love|romantic|melody)?\s*(?:song|version|mix|cover)\s*$/i, "").trim();
  return s;
}

export function apiTrackToTrack(t: ApiTrack): Track {
  const cleanTitle = displayTitle(t.title);
  const named = t.artist.replace(/\s*-\s*Topic\s*$/i, "").trim() || t.artist;
  return {
    id: t.videoId,
    title: cleanTitle || t.title,
    // "Unknown artist" is a parsing placeholder, not a credit — blank it; surfaces
    // fall back to the album name, and no subtitle reads cleaner than a fake one.
    artist: named === "Unknown artist" ? "" : named,
    album: t.album || "Single",
    duration: t.durationSec,
    lang: detectLang(t),
    year: 0,
    plays: t.views >= 1e9 ? `${(t.views / 1e9).toFixed(1)}B` : t.views >= 1e6 ? `${Math.round(t.views / 1e6)}M` : `${Math.round(t.views / 1e3)}K`,
    // Key the procedural palette on the ALBUM (then artwork, then id): every
    // version of the same poster glows identically — same art, same background
    // (videoId hashing gave identical covers unrelated washes).
    colors: colorFor(t.album || t.thumb || t.videoId),
    cover: t.thumb,
  };
}

/**
 * Language is only shown when we KNOW it. Live YTM results carry no language field,
 * so we trust explicit "(Hindi)"/"(Telugu)"-style markers in the title/album plus
 * native-script titles (Telugu/Tamil/… Unicode blocks) and stay silent otherwise.
 * Artist-name guessing is forbidden: Anirudh composes across Tamil, Telugu and
 * Hindi, which mislabeled every collab as "Tamil".
 */
function detectLang(t: ApiTrack): Track["lang"] {
  return detectTrackLang(t);
}

export async function searchApi(q: string, signal?: AbortSignal): Promise<Track[]> {
  if (IS_NATIVE) {
    // APK: no backend — run the identical originals-only YTM search in-process.
    const { searchOriginals } = await import("./yt/search");
    const data = await searchOriginals(q);
    return data.tracks.map((t) =>
      apiTrackToTrack({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
        views: t.views,
        tier: t.tier,
        thumb: t.thumb,
      })
    );
  }
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  return data.tracks.map(apiTrackToTrack);
}

// ── Radio (autoplay layer) ────────────────────────────────────────────────────

/**
 * `meta` (title/artist) powers the server's search fallback when the RDAMVM Mix
 * endpoint is bot-gated — without it an empty Mix means an empty queue.
 */
export async function radioApi(
  seedVideoId: string,
  meta?: { title?: string; artist?: string }
): Promise<Track[]> {
  if (IS_NATIVE) {
    // APK: the RDAMVM Mix queue resolved locally through the same filter pipeline.
    const { radioFor } = await import("./yt/radio");
    const data = await radioFor(seedVideoId, meta);
    return data.tracks.map((t) =>
      apiTrackToTrack({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
        views: t.views,
        tier: t.tier,
        thumb: t.thumb,
      })
    );
  }
  const p = new URLSearchParams();
  if (meta?.title) p.set("title", meta.title);
  if (meta?.artist) p.set("artist", meta.artist);
  const qs = p.toString();
  const res = await fetch(`/api/radio/${seedVideoId}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`radio ${res.status}`);
  const data = (await res.json()) as { tracks: ApiTrack[] };
  return data.tracks.map(apiTrackToTrack);
}

// ── Batch album art for seed-catalog tracks ──────────────────────────────────

type ThumbSignal = { id: string; title: string; artist: string };

/** Resolve cover art for tracks that don't have one (mock seed tracks). Fire-and-forget batching. */
export async function thumbsApi(items: ThumbSignal[]): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  if (IS_NATIVE) {
    // APK: same lookup the /api/thumbs route does server-side — originals-only
    // search per item, first tier hit with art — cached for the app session.
    const { searchOriginals } = await import("./yt/search");
    const covers: Record<string, string> = {};
    const pending = items.filter((x) => x?.id && x?.title && !thumbCache.has(keyOf(x.title, x.artist)));
    for (const x of pending) thumbCache.set(keyOf(x.title, x.artist), null); // reserve
    for (let i = 0; i < pending.length; i += 6) {
      const chunk = pending.slice(i, i + 6);
      await Promise.all(
        chunk.map(async (item) => {
          try {
            const artistFirst = item.artist.split(",")[0].trim();
            const res = await searchOriginals(`${item.title} ${artistFirst}`);
            const best = res.tracks.find((t) => t.thumb && t.durationSec >= 60) ?? res.tracks.find((t) => t.thumb);
            if (best?.thumb) {
              thumbCache.set(keyOf(item.title, item.artist), best.thumb);
              covers[item.id] = best.thumb;
            }
          } catch {
            thumbCache.delete(keyOf(item.title, item.artist)); // retried next session
          }
        })
      );
    }
    return covers;
  }
  const res = await fetch("/api/thumbs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`thumbs ${res.status}`);
  const data = (await res.json()) as { covers: Record<string, string> };
  return data.covers ?? {};
}

const thumbCache = new Map<string, string | null>(); // queryKey -> cover url | null

function keyOf(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.split(",")[0].toLowerCase().trim()}`;
}

/** Audio proxy URL — server resolves via Echo's client chain (+sibling fallback). */
export function audioUrlFor(id: string, title?: string, artist?: string, duration?: number): string {
  const p = new URLSearchParams();
  if (title) p.set("title", title);
  if (artist) p.set("artist", artist);
  if (duration) p.set("dur", String(Math.round(duration)));
  const qs = p.toString();
  return `/api/audio/${id}${qs ? `?${qs}` : ""}`;
}

// ── Native audio (APK) — the Echo chain runs on-device ───────────────────────

export interface NativeStream {
  url: string;
  client: string;
  viaSibling: boolean;
}

/**
 * Resolve a playable googlevideo URL on-device: same client chain, probe and
 * sibling fallback as the server's /api/audio route, minus the proxy hop —
 * the URL is minted from THIS device's IP, so googlevideo serves it directly
 * to the <audio> element (media elements need no CORS).
 *
 * NATIVE ONLY: in a plain browser music.youtube.com sends no CORS headers, so
 * this chain's fetches are doomed — the player only calls this when IS_NATIVE.
 * Hard contract: resolves to null on ANY failure — it must never throw into
 * the player (an escaping rejection here was the app's "Failed to fetch" crash).
 */
export async function resolveNativeAudio(
  id: string,
  title?: string,
  artist?: string,
  duration?: number
): Promise<NativeStream | null> {
  try {
    const { resolveStreamSmart } = await import("./yt/resolve");
    const r = await resolveStreamSmart(id, {
      title,
      artist,
      durationSec: duration ? Math.round(duration) : undefined,
    });
    if (!r) return null;
    return { url: r.url, client: r.client, viaSibling: r.viaSibling };
  } catch {
    return null; // resolve is best-effort — callers fall back cleanly
  }
}

/** Drop cached stream URLs for a track (googlevideo 403/expiry → force fresh resolve). */
export async function invalidateNativeAudio(id: string, clientName?: string): Promise<void> {
  try {
    const { invalidateStream } = await import("./yt/resolve");
    invalidateStream(id, clientName);
  } catch {
    /* cache clearing is best-effort */
  }
}
