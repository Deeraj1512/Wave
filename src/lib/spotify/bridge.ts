/**
 * Client bridge to the Spotify layer (Phase 1 + Phase 3).
 *
 * Every call hits /api/spotify/* — on the WEB runtime same-origin, on the
 * APK through the Cloudflare Worker bridge deployed by GitHub Actions (see
 * config.ts). The bridge is a METADATA-ONLY Spotify proxy (the client secret
 * lives in Worker env vars only); matching to playable videoIds happens HERE,
 * client-side, through match.ts → the app's own originals-only YTM chain —
 * the same path the search tab uses. Results convert into the app's Track
 * shape so playback/queue/radio/likes/history run unchanged.
 *
 * The availability probe is cached 10 minutes (session-lifetime cost of one
 * status call): with no credentials configured the UI hides every Spotify
 * surface instead of showing errors — Wave stays a pure YTM app until the
 * owner deploys the bridge.
 */

import { colorFor } from "../data";
import { detectTrackLang, guessLangFromWords, inferLiveLang } from "../langs";
import type { Track } from "../types";
import { spotifyBridgeBase } from "./config";
import { matchSpotifyBatch } from "./match";
import type { SpMatchInput } from "./match";
import type {
  SpPicksResult,
  SpPlaylistLite,
  SpPlaylistResult,
  SpRelatedResult,
  SpSearchResult,
  SpTrackHit,
} from "./types";

/** Fill videoIds into metadata-only hits (client-side matcher, session-cached). */
export async function attachMatches(hits: SpTrackHit[]): Promise<SpTrackHit[]> {
  const pending = hits.filter((t) => !t.videoId);
  if (pending.length === 0) return hits;
  const inputs: SpMatchInput[] = pending.map((t) => ({
    id: t.spotifyId,
    name: t.title,
    durationMs: t.durationSec * 1000,
    artists: t.artist.split(", "),
  }));
  const matches = await matchSpotifyBatch(inputs);
  const byId = new Map(pending.map((t, i) => [t.spotifyId, matches[i]]));
  return hits.map((t) => {
    const m = byId.get(t.spotifyId);
    return m && !t.videoId ? { ...t, videoId: m.videoId, confidence: m.confidence } : t;
  });
}

let probe: { at: number; ok: boolean; clientId: string } | null = null;

export async function spotifyAvailable(): Promise<boolean> {
  const base = spotifyBridgeBase();
  if (!base) return false;
  if (probe && Date.now() - probe.at < 10 * 60 * 1000) return probe.ok;
  try {
    const res = await fetch(`${base}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { configured?: boolean; clientId?: string };
    probe = { at: Date.now(), ok: !!data.configured, clientId: data.clientId ?? "" };
  } catch {
    probe = { at: Date.now(), ok: false, clientId: "" };
  }
  return probe.ok;
}

/** The PUBLIC application id (safe to embed — PKCE involves no secret), used
 *  by the in-app Spotify login. Empty when the bridge is down/unconfigured. */
export function spotifyClientId(): string {
  return probe?.clientId ?? "";
}

export async function spotifySearch(q: string, signal?: AbortSignal): Promise<SpSearchResult> {
  const res = await fetch(`${spotifyBridgeBase()}/search?q=${encodeURIComponent(q)}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify search ${res.status}`);
  const data = (await res.json()) as SpSearchResult;
  if (!data.configured) return data;
  data.tracks = await attachMatches(data.tracks);
  return data;
}

export async function spotifyPicks(
  artists: string[],
  genres: string[],
  limit = 20
): Promise<SpPicksResult> {
  const p = new URLSearchParams();
  if (artists.length) p.set("artists", artists.join(","));
  if (genres.length) p.set("genres", genres.join(","));
  p.set("limit", String(limit));
  try {
    const res = await fetch(`${spotifyBridgeBase()}/picks?${p.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`picks ${res.status}`);
    const data = (await res.json()) as SpPicksResult;
    if (data.available) data.tracks = await attachMatches(data.tracks);
    return data;
  } catch (e) {
    return {
      available: false,
      source: "fallback",
      tracks: [],
      reason: e instanceof Error ? e.message : "picks failed",
    };
  }
}

export async function spotifyRelated(artist: string): Promise<SpRelatedResult> {
  try {
    const res = await fetch(`${spotifyBridgeBase()}/related?artist=${encodeURIComponent(artist)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`related ${res.status}`);
    return (await res.json()) as SpRelatedResult;
  } catch (e) {
    return {
      available: false,
      artists: [],
      reason: e instanceof Error ? e.message : "related failed",
    };
  }
}

/** Full Spotify playlist page: metadata + track metadata, then matched here.
 *  App-token endpoint (no login needed) — works for public/search playlists. */
export async function spotifyPlaylistPage(id: string): Promise<SpPlaylistResult> {
  const res = await fetch(`${spotifyBridgeBase()}/playlist?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify playlist ${res.status}`);
  const data = (await res.json()) as SpPlaylistResult;
  data.tracks = await attachMatches(data.tracks);
  return data;
}

/**
 * Spotify hit → first-class Track. Matched hits only (callers render
 * unmatched ones dimmed without conversion). The language ladder mirrors
 * api.ts's detectLang: explicit markers → live-catalog inference (artist
 * evidence forbidden for single songs) → native-script word guessing.
 */
export function spotifyHitToTrack(h: SpTrackHit): Track {
  return {
    id: h.videoId ?? "",
    title: h.title,
    artist: h.artist,
    album: h.albumName || "Single",
    duration: h.durationSec,
    lang:
      detectTrackLang({ title: h.title, album: h.albumName }) ??
      inferLiveLang({ title: h.title, album: h.albumName, artist: h.artist }, undefined, { noArtist: true }) ??
      guessLangFromWords(`${h.title} ${h.albumName}`),
    year: Number.parseInt(h.year ?? "", 10) || 0,
    plays: "",
    colors: colorFor(h.albumName || h.title || h.spotifyId),
    cover: h.image,
  };
}
