/**
 * Wave Spotify bridge — a tiny METADATA-ONLY Cloudflare Worker.
 *
 * Why this exists: the Spotify CLIENT SECRET must never ship inside the APK
 * (an APK is a frontend anyone can unzip), and Wave is built by GitHub
 * Actions as a static APK with no server of its own. This worker holds the
 * secret in Cloudflare env vars and answers the exact same shapes as the
 * app's /api/spotify/* dev routes. It is deployed automatically from this
 * repo by .github/workflows/deploy-bridge.yml — no Netlify, no website, the
 * app itself stays repo → Actions → APK.
 *
 * Endpoints (all GET, CORS open — the APK uses native HTTP anyway):
 *   /api/spotify/status   → { configured }           availability probe
 *   /api/spotify/search   → tracks/artists/albums    metadata only
 *   /api/spotify/picks    → Phase 3 recommendations  (gated → fallback lane)
 *   /api/spotify/related  → Phase 3 fans-also-like   (gated → available:false)
 *
 * Matching Spotify tracks to playable YouTube videoIds happens CLIENT-side
 * in the app (src/lib/spotify/match.ts) — this worker stays a pure Spotify
 * proxy with zero YouTube involvement.
 *
 * KEEP IN SYNC with src/lib/spotify/serverAuth.ts / serverResolve.ts and the
 * /api/spotify/* route shapes.
 */

export interface Env {
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ── auth (Client Credentials) ────────────────────────────────────────────────

class SpotifyUnavailableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let minting: Promise<string> | null = null;

/** Worker env binding for the current request (set at the top of fetch()). */
let ENV: Record<string, string | undefined> = {};
function env_str(key: string): string {
  return (ENV[key] ?? "").trim();
}

function credentials(): { id: string; secret: string } | null {
  const id = env_str("SPOTIFY_CLIENT_ID");
  const secret = env_str("SPOTIFY_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
}

function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return Promise.resolve(cachedToken.value);
  if (minting) return minting;
  const creds = credentials();
  if (!creds) {
    return Promise.reject(new SpotifyUnavailableError(500, "missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET"));
  }
  minting = (async () => {
    const basic = btoa(`${creds.id}:${creds.secret}`);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new SpotifyUnavailableError(res.status, `spotify token ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
    };
    return cachedToken.value;
  })();
  return minting.finally(() => {
    minting = null;
  });
}

async function spotifyApi<T>(path: string): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    cachedToken = null; // force a fresh mint next call
    throw new SpotifyUnavailableError(401, "spotify token rejected");
  }
  if (!res.ok) throw new SpotifyUnavailableError(res.status, `spotify ${res.status} for ${path}`);
  return (await res.json()) as T;
}

function isGated(e: unknown): boolean {
  const st = (e as SpotifyUnavailableError)?.status;
  return st === 403 || st === 404;
}

// ── shared seed resolvers (port of serverResolve.ts) ─────────────────────────

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

interface SpApiArtist { id: string; name: string }

const artistIdCache = new Map<string, { at: number; id: string | null }>();
const ARTIST_ID_TTL = 24 * 60 * 60 * 1000;

async function artistIdByName(name: string, market: string): Promise<string | null> {
  const key = `${name.toLowerCase()}|${market}`;
  const hit = artistIdCache.get(key);
  if (hit && Date.now() - hit.at < ARTIST_ID_TTL) return hit.id;
  try {
    const data = await spotifyApi<{ artists: { items: SpApiArtist[] } }>(
      `/search?q=${encodeURIComponent(name)}&type=artist&limit=3&market=${encodeURIComponent(market)}`
    );
    const items = data.artists?.items ?? [];
    const exact = items.find((a) => fold(a.name) === fold(name));
    const id = (exact ?? items[0])?.id ?? null;
    artistIdCache.set(key, { at: Date.now(), id });
    return id;
  } catch {
    artistIdCache.set(key, { at: Date.now(), id: null });
    return null;
  }
}

let genreSeedsCache: { at: number; genres: Set<string> } | null = null;
const GENRE_TTL = 24 * 60 * 60 * 1000;

async function validGenreSeeds(): Promise<Set<string> | null> {
  if (genreSeedsCache && Date.now() - genreSeedsCache.at < GENRE_TTL) return genreSeedsCache.genres;
  try {
    const data = await spotifyApi<{ genres: string[] }>("/recommendations/available-genre-seeds");
    const set = new Set(data.genres.map((g) => g.toLowerCase()));
    genreSeedsCache = { at: Date.now(), genres: set };
    return set;
  } catch {
    return null;
  }
}

// ── response shaping (same shapes as the /api/spotify dev routes) ────────────

interface SpApiImage { url: string; width: number; height: number }
interface SpApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  popularity: number;
  artists: { name: string }[];
  album?: { name?: string; release_date?: string; images?: SpApiImage[] };
}
interface SpApiArtistFull {
  id: string;
  name: string;
  images?: SpApiImage[];
  followers?: { total?: number };
}
interface SpApiAlbum {
  id: string;
  name: string;
  release_date?: string;
  total_tracks?: number;
  artists?: { name: string }[];
  images?: SpApiImage[];
}

function bestImage(images: SpApiImage[] | undefined, want: number): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) ?? sorted[sorted.length - 1]).url;
}

function toHit(t: SpApiTrack) {
  return {
    spotifyId: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    albumName: t.album?.name ?? "",
    durationSec: Math.round(t.duration_ms / 1000),
    image: bestImage(t.album?.images, 640),
    popularity: t.popularity ?? 0,
    year: t.album?.release_date?.slice(0, 4),
    videoId: null as string | null, // matched client-side (match.ts)
    confidence: 0,
  };
}

// ── handlers ─────────────────────────────────────────────────────────────────

const searchCache = new Map<string, { at: number; data: unknown }>();
const SEARCH_TTL = 10 * 60 * 1000;

async function handleSearch(url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  if (!q) return json({ error: "missing q" }, 400);
  if (!credentials()) return json({ configured: false, tracks: [], artists: [], albums: [] });
  const market = url.searchParams.get("market") || "IN";
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));

  const key = `${q.toLowerCase()}|${limit}|${market}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) {
    return json({ ...(hit.data as object), cached: true });
  }

  try {
    const data = await spotifyApi<{
      tracks?: { items: SpApiTrack[] };
      artists?: { items: SpApiArtistFull[] };
      albums?: { items: SpApiAlbum[] };
    }>(
      `/search?q=${encodeURIComponent(q)}&type=track,artist,album&limit=${limit}&market=${encodeURIComponent(market)}`
    );

    const artists = (data.artists?.items ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      name: a.name,
      image: bestImage(a.images, 300),
      followers: a.followers?.total,
    }));

    const albums = (data.albums?.items ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      title: a.name,
      artist: a.artists?.[0]?.name ?? "",
      year: a.release_date?.slice(0, 4),
      image: bestImage(a.images, 300),
      totalTracks: a.total_tracks,
    }));

    const tracks = (data.tracks?.items ?? []).slice(0, limit).map(toHit);

    const out = { configured: true, tracks, artists, albums };
    searchCache.set(key, { at: Date.now(), data: out });
    return json(out);
  } catch (e) {
    return json(
      {
        configured: true,
        tracks: [],
        artists: [],
        albums: [],
        error: e instanceof Error ? e.message : "spotify search failed",
      },
      502
    );
  }
}

async function handlePicks(url: URL): Promise<Response> {
  if (!credentials()) {
    return json({ available: false, source: "fallback", tracks: [], reason: "not configured" });
  }
  const market = url.searchParams.get("market") || "IN";
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit") || "15", 10) || 15));
  const artistNames = (url.searchParams.get("artists") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const genreWants = (url.searchParams.get("genres") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);

  if (artistNames.length === 0 && genreWants.length === 0) {
    return json({ available: false, source: "fallback", tracks: [], reason: "no seeds" });
  }

  // ── lane 1: real recommendations (Extended Quota) ──
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
        return json({ available: true, source: "recommendations", tracks: items.map(toHit) });
      } catch {
        // gated or transport failure — fall through to the fallback lane
      }
    }
  }

  // ── lane 2: fallback — popularity-ranked search from the same seeds ──
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
      return json({ available: false, source: "fallback", tracks: [], reason: "no seeds matched" });
    }
    return json({ available: true, source: "fallback", tracks: items.map(toHit) });
  } catch (e) {
    return json({
      available: false,
      source: "fallback",
      tracks: [],
      reason: e instanceof Error ? e.message : "picks failed",
    });
  }
}

async function handleRelated(url: URL): Promise<Response> {
  const name = url.searchParams.get("artist")?.trim();
  if (!name) return json({ available: false, artists: [], reason: "missing artist" });
  const market = url.searchParams.get("market") || "IN";

  const id = await artistIdByName(name, market);
  if (!id) return json({ available: false, artists: [], reason: "artist not found" });

  try {
    const data = await spotifyApi<{ artists: SpApiArtistFull[] }>(
      `/artists/${encodeURIComponent(id)}/related-artists`
    );
    const artists = (data.artists ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      name: a.name,
      image: bestImage(a.images, 300),
      followers: a.followers?.total,
    }));
    return json({ available: true, artists });
  } catch (e) {
    const reason = isGated(e) ? "gated (needs Extended Quota)" : e instanceof Error ? e.message : "related failed";
    return json({ available: false, artists: [], reason });
  }
}

async function handleStatus(): Promise<Response> {
  if (!credentials()) return json({ configured: false });
  try {
    await accessToken();
    return json({ configured: true });
  } catch {
    return json({ configured: false });
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    ENV = (env ?? {}) as Record<string, string | undefined>;
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    // accept both /status and /api/spotify/status
    let path = url.pathname.replace(/\/+$/, "");
    const prefix = "/api/spotify";
    if (path.startsWith(prefix)) path = path.slice(prefix.length) || "/";

    switch (path) {
      case "/status":
        return handleStatus();
      case "/search":
        return handleSearch(url);
      case "/picks":
        return handlePicks(url);
      case "/related":
        return handleRelated(url);
      default:
        return json({ error: "not found" }, 404);
    }
  },
};
