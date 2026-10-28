/**
 * Client API layer — the single swap point between the UI and the Wave backend
 * (which is Echo-Music's streaming strategy ported to our server).
 */
import type { Track } from "./types";
import { colorFor } from "./data";
import { detectTrackLang } from "./langs";

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
    colors: colorFor(t.videoId),
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
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  return data.tracks.map(apiTrackToTrack);
}

// ── Radio (autoplay layer) ────────────────────────────────────────────────────

export async function radioApi(seedVideoId: string): Promise<Track[]> {
  const res = await fetch(`/api/radio/${seedVideoId}`);
  if (!res.ok) throw new Error(`radio ${res.status}`);
  const data = (await res.json()) as { tracks: ApiTrack[] };
  return data.tracks.map(apiTrackToTrack);
}

// ── Batch album art for seed-catalog tracks ──────────────────────────────────

type ThumbSignal = { id: string; title: string; artist: string };

/** Resolve cover art for tracks that don't have one (mock seed tracks). Fire-and-forget batching. */
export async function thumbsApi(items: ThumbSignal[]): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  const res = await fetch("/api/thumbs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`thumbs ${res.status}`);
  const data = (await res.json()) as { covers: Record<string, string> };
  return data.covers ?? {};
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
