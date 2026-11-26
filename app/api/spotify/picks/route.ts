import { NextRequest, NextResponse } from "next/server";
import { isGated, spotifyApi, spotifyConfigured } from "@/lib/spotify/serverAuth";
import { matchSpotifyBatch, type SpMatchInput } from "@/lib/spotify/serverMatch";
import { artistIdByName, validGenreSeeds } from "@/lib/spotify/serverResolve";
import type { SpTrackHit } from "@/lib/spotify/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/picks?artists=Name1,Name2&genres=telugu,hindi&limit=&market=
 *
 * PHASE 3 — "Spotify picks": recommendations seeded by what the listener
 * actually plays (top artists from listening history + taste languages as
 * genre seeds). Spotify caps seeds at 5; the client sends ≤3 names and ≤3
 * genres and we prioritize genres + the two strongest artists.
 *
 * Quota reality (Nov 2024 API changes): /recommendations is gated for apps
 * not in Extended Quota Mode — dev apps get 403. Two layers of resilience:
 *   1. genre seeds are validated against /available-genre-seeds first; if
 *      THAT fails, recommendations almost surely would too (skip to fallback).
 *   2. fallback builder — popularity-ranked search per seed artist (or genre
 *      term), deduped by title+artist, matched to videoIds like everywhere
 *      else. "Picks" works in dev mode, and upgrades automatically to real
 *      recommendations when Extended Quota is granted.
 */

interface SpApiImage { url: string; width: number; height: number }
interface SpApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  popularity: number;
  artists: { name: string }[];
  album?: { name?: string; release_date?: string; images?: SpApiImage[] };
}
interface SpApiArtist { id: string; name: string }
interface SpApiAlbum { name?: string; images?: SpApiImage[] }

function bestImage(images: SpApiImage[] | undefined, want: number): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) ?? sorted[sorted.length - 1]).url;
}

function toInput(t: SpApiTrack): SpMatchInput {
  return { id: t.id, name: t.name, durationMs: t.duration_ms, artists: t.artists.map((a) => a.name) };
}

function toHit(t: SpApiTrack, videoId: string | null, confidence: number): SpTrackHit {
  return {
    spotifyId: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    albumName: t.album?.name ?? "",
    durationSec: Math.round(t.duration_ms / 1000),
    image: bestImage(t.album?.images, 640),
    popularity: t.popularity ?? 0,
    year: t.album?.release_date?.slice(0, 4),
    videoId,
    confidence,
  };
}

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export async function GET(req: NextRequest) {
  if (!spotifyConfigured()) {
    return NextResponse.json({ available: false, source: "fallback", tracks: [], reason: "not configured" });
  }
  const market = req.nextUrl.searchParams.get("market") || "IN";
  const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "15", 10) || 15));
  const artistNames = (req.nextUrl.searchParams.get("artists") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const genreWants = (req.nextUrl.searchParams.get("genres") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);

  if (artistNames.length === 0 && genreWants.length === 0) {
    return NextResponse.json({ available: false, source: "fallback", tracks: [], reason: "no seeds" });
  }

  // ── lane 1: real recommendations (Extended Quota) ──────────────────────────
  const seeds = await validGenreSeeds();
  if (seeds) {
    const genres = genreWants.filter((g) => seeds.has(g));
    const artistIds: string[] = [];
    for (const name of artistNames) {
      if (artistIds.length >= 5 - genres.length) break;
      const id = await artistIdByName(name, market);
      if (id && !artistIds.includes(id)) artistIds.push(id);
    }
    if (genres.length + artistIds.length > 0) {
      const p = new URLSearchParams({ limit: String(limit), market });
      if (artistIds.length) p.set("seed_artists", artistIds.join(","));
      if (genres.length) p.set("seed_genres", genres.join(","));
      try {
        const data = await spotifyApi<{ tracks: SpApiTrack[] }>(`/recommendations?${p.toString()}`);
        const items = (data.tracks ?? []).filter((t) => t && t.id).slice(0, limit);
        const matches = await matchSpotifyBatch(items.map(toInput));
        const tracks = items.map((t, i) => toHit(t, matches[i]?.videoId ?? null, matches[i]?.confidence ?? 0));
        return NextResponse.json({ available: true, source: "recommendations", tracks });
      } catch (e) {
        if (!isGated(e)) {
          // transport-level failure — surface the fallback anyway, no error to the user
        }
      }
    }
  }

  // ── lane 2: fallback — popularity-ranked search from the same seeds ────────
  try {
    const collected: SpApiTrack[] = [];
    const seen = new Set<string>();
    const push = (items: SpApiTrack[]) => {
      for (const t of items) {
        if (!t?.id) continue;
        const key = `${fold(t.name)}|${fold(t.artists?.[0]?.name ?? "")}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collected.push(t);
      }
    };
    if (artistNames.length > 0) {
      for (const name of artistNames) {
        const data = await spotifyApi<{ tracks?: { items: SpApiTrack[] } }>(
          `/search?q=${encodeURIComponent(name)}&type=track&limit=10&market=${encodeURIComponent(market)}`
        );
        push(data.tracks?.items ?? []);
      }
    } else {
      for (const g of genreWants.slice(0, 2)) {
        const data = await spotifyApi<{ tracks?: { items: SpApiTrack[] } }>(
          `/search?q=${encodeURIComponent(g)}&type=track&limit=10&market=${encodeURIComponent(market)}`
        );
        push(data.tracks?.items ?? []);
      }
    }
    collected.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    const items = collected.slice(0, limit);
    if (items.length === 0) {
      return NextResponse.json({ available: false, source: "fallback", tracks: [], reason: "no seeds matched" });
    }
    const matches = await matchSpotifyBatch(items.map(toInput));
    const tracks = items.map((t, i) => toHit(t, matches[i]?.videoId ?? null, matches[i]?.confidence ?? 0));
    return NextResponse.json({ available: true, source: "fallback", tracks });
  } catch (e) {
    return NextResponse.json(
      {
        available: false,
        source: "fallback",
        tracks: [],
        reason: e instanceof Error ? e.message : "picks failed",
      },
      { status: 200 }
    );
  }
}
