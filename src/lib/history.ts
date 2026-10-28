"use client";

/**
 * Listening history + taste profile — the brain behind the personalized home feed.
 *
 * Every track start funnels through one player hook, which calls recordPlay().
 * Entries persist in localStorage (last ~120 plays, play counts). From this we derive:
 *  - recentPlays()   → "Pick up where you left off" / "Jump back in"
 *  - topArtists()    → personalized artists shelf
 *  - radioSeed()     → "Because you listened to …" (needs a real videoId)
 *
 * Refresh variety: a per-mount random seed drives a stable-in-session Fisher-Yates,
 * so shelves reshuffle on every page load (like YTM Quick picks / Spotify home).
 */

export interface HistoryEntry {
  id: string; // real videoId when known; mock seed ids tolerated but never used as radio seeds
  title: string;
  artist: string;
  cover?: string;
  at: number; // last-played epoch ms
  n: number; // play count
}

const LS_KEY = "dhun.history.v1";
const CAP = 120;

const byId = new Map<string, HistoryEntry>();
const listeners = new Set<() => void>();
let hydrated = false;
let version = 0;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    for (const e of JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as HistoryEntry[]) byId.set(e.id, e);
  } catch {
    /* fresh install */
  }
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...byId.values()].slice(0, CAP)));
  } catch {
    /* private mode — in-memory only */
  }
}

function notify() {
  version++;
  for (const l of listeners) l();
}

export function subscribeHistory(l: () => void): () => void {
  hydrate();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function historyVersion(): number {
  return version;
}

export function recordPlay(t: { id: string; title: string; artist: string; cover?: string }) {
  hydrate();
  if (!t.id || !t.title) return;
  const prev = byId.get(t.id);
  byId.set(t.id, {
    ...t,
    at: Date.now(),
    n: (prev?.n ?? 0) + 1,
    cover: t.cover ?? prev?.cover,
  });
  // cap + keep the freshest
  if (byId.size > CAP) {
    const stale = [...byId.values()].sort((a, b) => a.at - b.at).slice(0, byId.size - CAP);
    for (const e of stale) byId.delete(e.id);
  }
  persist();
  notify();
}

function all(): HistoryEntry[] {
  hydrate();
  return [...byId.values()];
}

export interface RecentPlay {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  at: number;
  n: number;
}

/** Most recent plays, deduped by song identity (id swaps like t01→videoId collapse). */
export function recentPlays(limit = 10): RecentPlay[] {
  const seen = new Set<string>();
  const out: RecentPlay[] = [];
  for (const e of all().sort((a, b) => b.at - a.at)) {
    if (!e?.id || !e?.title) continue; // corrupted/manual storage entries never crash the feed
    const key = `${e.title.toLowerCase().trim()}|${e.artist.split(",")[0].toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: e.id, title: e.title, artist: e.artist, cover: e.cover, at: e.at, n: e.n });
    if (out.length >= limit) break;
  }
  return out;
}

/** Most-played primary artists, weighted by count + recency. */
export function topArtists(limit = 8): string[] {
  const score = new Map<string, number>();
  const now = Date.now();
  for (const e of all()) {
    const a = e.artist.split(",")[0].trim();
    if (!a) continue;
    const recency = 1 + 0.5 * Math.max(0, 1 - (now - e.at) / (7 * 864e5)); // +0..0.5 within a week
    score.set(a, (score.get(a) ?? 0) + e.n * recency);
  }
  return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit).map(([a]) => a);
}

/**
 * Best seed for a "Because you listened to …" radio: real videoId only,
 * ranked by play count with recency decay. Returns the entry or null.
 */
export function radioSeed(): HistoryEntry | null {
  const now = Date.now();
  return (
    all()
      .filter((e) => /^[\w-]{11}$/.test(e.id))
      .map((e) => ({ e, w: e.n * (1 + Math.max(0, 1 - (now - e.at) / (3 * 864e5))) }))
      .sort((a, b) => b.w - a.w)
      .map(({ e }) => e)[0] ?? null
  );
}

// ── Refresh-variety randomizer (stable within a mount) ─────────────────────────

/** Mulberry32 — tiny seeded PRNG so a mount's shuffle is stable across its renders. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick k distinct items from a pool, rotated by the mount seed (fresh every refresh). */
export function pickRotated<T>(pool: T[], k: number, rnd: () => number): T[] {
  if (pool.length === 0) return [];
  const start = Math.floor(rnd() * pool.length);
  const out: T[] = [];
  for (let i = 0; i < Math.min(k, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}
