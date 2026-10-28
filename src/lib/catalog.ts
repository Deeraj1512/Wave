/**
 * Shared real catalog — fetched once per session from the Wave backend (InnerTube
 * search), cached module-level so every screen shares the same tracks. There is NO
 * fallback song data: if the backend is unreachable the catalog is simply empty and
 * every surface shows an honest empty/error state (and the next caller retries).
 */
import type { Track, Lang } from "./types";
import { searchApi } from "./api";

/**
 * Seed searches, each with the language that query anchors to. The language is used
 * ONLY to fill the gap for romanized titles that carry no explicit "(Hindi)"-style
 * marker and no native script — explicit markers and scripts always win (they are
 * applied in api.ts before this fallback ever runs).
 */
const SEEDS: Array<{ q: string; lang: Lang }> = [
  { q: "top bollywood hits", lang: "Hindi" },
  { q: "arijit singh songs", lang: "Hindi" },
  { q: "tamil hit songs", lang: "Tamil" },
  { q: "telugu hit songs", lang: "Telugu" },
  { q: "punjabi hits", lang: "Punjabi" },
  { q: "kannada hit songs", lang: "Kannada" },
  { q: "malayalam hit songs", lang: "Malayalam" },
  { q: "hindi indie songs", lang: "Hindi" },
];

let promise: Promise<Track[]> | null = null;
let resolved: Track[] | null = null;

/** Sync access to the already-resolved catalog (null until the fetch lands). */
export function catalogNow(): Track[] | null {
  return resolved;
}

export function catalogTracks(): Promise<Track[]> {
  if (!promise) {
    promise = (async () => {
      try {
        const all = new Map<string, Track>();
        const results = await Promise.allSettled(
          SEEDS.map(async ({ q, lang }) => ({ lang, ts: await searchApi(q) })),
        );
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const t of r.value.ts) {
            if (!t.lang) t.lang = r.value.lang; // romanized title — the query's language anchors it
            if (!all.has(t.id)) all.set(t.id, t);
          }
        }
        const list = [...all.values()];
        resolved = list;
        if (list.length === 0) promise = null; // nothing came back — a later caller retries
        return list;
      } catch {
        resolved = [];
        promise = null;
        return [];
      }
    })();
  }
  return promise;
}
