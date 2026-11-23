/**
 * Artist catalog — the names + faces behind the home Radio shelf (and, in the
 * next batch, the onboarding artist-pick step).
 *
 * Two jobs:
 *  1. radioArtists() — whose circles show on the shelf. Your top listening
 *     artists come first (the taste brain, history.topArtists); the shelf is
 *     padded with a curated cross-language list of widely-known artists so a
 *     brand-new user sees a full Radio row instead of an empty block.
 *  2. artistImage() — a real photo for each circle. There is no artist-photo
 *     endpoint in our stack, so the artist's top song's album art stands in
 *     (the same trick YTM's offline fallbacks use). Sources, cheapest first:
 *     the session catalog (already fetched, instant) → a live search for the
 *     artist's name. Persisted in localStorage so a photo is fetched once, ever.
 */

import { searchApi } from "./api";
import { catalogTracks } from "./catalog";
import { topArtists } from "./history";
import type { Track } from "./types";

/** Diacritic-strip + lowercase + whitespace collapse — the artist matching key. */
export function fold(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Curated cold-start artists, per language. ONLY radio seeds — tap → search the
 * name → play their top song as the seed. Names are real, widely-known artists;
 * nothing here is a claim about catalog contents.
 */
export const DEFAULT_RADIO_ARTISTS: Array<{ name: string; lang: string }> = [
  { name: "Arijit Singh", lang: "Hindi" },
  { name: "Sid Sriram", lang: "Telugu" },
  { name: "Anirudh Ravichander", lang: "Tamil" },
  { name: "Shreya Ghoshal", lang: "Hindi" },
  { name: "A.R. Rahman", lang: "Tamil" },
  { name: "S. P. Balasubrahmanyam", lang: "Telugu" },
  { name: "Devi Sri Prasad", lang: "Telugu" },
  { name: "Yuvan Shankar Raja", lang: "Tamil" },
  { name: "Diljit Dosanjh", lang: "Punjabi" },
  { name: "AP Dhillon", lang: "Punjabi" },
  { name: "Vijay Prakash", lang: "Kannada" },
  { name: "Ananya Bhat", lang: "Kannada" },
  { name: "K. S. Chithra", lang: "Malayalam" },
  { name: "Shaan Rahman", lang: "Malayalam" },
  { name: "Anupam Roy", lang: "Bengali" },
  { name: "Pritam", lang: "Hindi" },
];

/** Is `track` sung (at least partly) by `artistName`? Folded, prefix-tolerant. */
export function isArtistTrack(track: Track, artistName: string): boolean {
  const target = fold(artistName);
  if (!target) return false;
  return track.artist
    .split(",")
    .map((a) => fold(a))
    .some((a) => a === target || (target.length > 3 && a.includes(target)));
}

/**
 * The Radio shelf's artist list — up to `limit` names. Your own top artists
 * lead; curated defaults fill the rest so the shelf is never half-empty.
 */
export function radioArtists(limit = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const k = fold(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(name);
  };
  try {
    for (const a of topArtists(12)) {
      if (out.length >= limit) break;
      push(a);
    }
  } catch {
    /* no history yet — cold start below fills the shelf */
  }
  for (const d of DEFAULT_RADIO_ARTISTS) {
    if (out.length >= limit) break;
    push(d.name);
  }
  return out;
}

// ── artist photo resolution (album-art stand-in, cached forever) ──────────────

const IMG_KEY = "wave.artistImg.v1";
const imgCache = new Map<string, string>(); // folded name → url ("" = tried, none)
let imgHydrated = false;
const inflight = new Map<string, Promise<string | undefined>>();

function imgStore(): Map<string, string> {
  if (!imgHydrated && typeof window !== "undefined") {
    imgHydrated = true;
    try {
      for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(IMG_KEY) ?? "{}") as Record<string, string>)) {
        imgCache.set(k, v);
      }
    } catch {
      /* fresh install */
    }
  }
  return imgCache;
}

function saveImgs() {
  try {
    localStorage.setItem(IMG_KEY, JSON.stringify(Object.fromEntries(imgCache)));
  } catch {
    /* best-effort */
  }
}

/**
 * Photo URL for the Radio shelf circle — the artist's own song art. Resolves
 * undefined when nothing was found (negative-cached, so it never re-fetches).
 */
export function artistImage(name: string): Promise<string | undefined> {
  const key = fold(name);
  if (!key) return Promise.resolve(undefined);
  const hit = imgStore().get(key);
  if (hit !== undefined) return Promise.resolve(hit || undefined);
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const byArtist = (t: Track) => isArtistTrack(t, name);
      // source 1: session catalog — already fetched, zero network cost
      const cat = await catalogTracks().catch(() => [] as Track[]);
      const inCat = cat.find((t) => t.cover && byArtist(t));
      if (inCat?.cover) {
        imgCache.set(key, inCat.cover);
        saveImgs();
        return inCat.cover;
      }
      // source 2: live search — their top song's art stands in as the portrait
      const res = await searchApi(name).catch(() => [] as Track[]);
      const match = res.find((t) => t.cover && byArtist(t)) ?? res.find((t) => t.cover);
      if (match?.cover) {
        imgCache.set(key, match.cover);
        saveImgs();
        return match.cover;
      }
      imgCache.set(key, ""); // negative cache — never re-fetch a miss
      saveImgs();
      return undefined;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
