/**
 * Client bridge to the Spotify layer (Phase 1 + Phase 3).
 *
 * Every call hits /api/spotify/* — on the WEB runtime same-origin, on the
 * APK through the deployed site's bridge (see config.ts). The bridge returns
 * entities ALREADY matched to videoIds; this layer only converts them into
 * the app's Track shape so playback/queue/radio/likes/history run unchanged.
 *
 * The availability probe is cached 10 minutes (session-lifetime cost of one
 * status call): with no credentials configured the UI hides every Spotify
 * surface instead of showing errors — Wave stays a pure YTM app until the
 * owner adds the env vars.
 */

import { colorFor } from "../data";
import { detectTrackLang, guessLangFromWords, inferLiveLang } from "../langs";
import type { Track } from "../types";
import { spotifyBridgeBase } from "./config";
import type { SpPicksResult, SpRelatedResult, SpSearchResult, SpTrackHit } from "./types";

let probe: { at: number; ok: boolean } | null = null;

export async function spotifyAvailable(): Promise<boolean> {
  const base = spotifyBridgeBase();
  if (!base) return false;
  if (probe && Date.now() - probe.at < 10 * 60 * 1000) return probe.ok;
  try {
    const res = await fetch(`${base}/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { configured?: boolean };
    probe = { at: Date.now(), ok: !!data.configured };
  } catch {
    probe = { at: Date.now(), ok: false };
  }
  return probe.ok;
}

export async function spotifySearch(q: string, signal?: AbortSignal): Promise<SpSearchResult> {
  const res = await fetch(`${spotifyBridgeBase()}/search?q=${encodeURIComponent(q)}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify search ${res.status}`);
  return (await res.json()) as SpSearchResult;
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
    return (await res.json()) as SpPicksResult;
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
