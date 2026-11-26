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
 *
 * The seeds do double duty: (a) the shared discovery pool the feed shelves draw
 * from, and (b) the language-classification knowledge base (movie/album names +
 * artist profiles indexed from these tracks — Hindi seeds stay even for a
 * Telugu-only listener BECAUSE they teach the detector what Hindi looks like).
 * On top of the shared base, the listener's SELECTED languages get extra seeds so
 * their own languages dominate the discovery pool (a Telugu + Tamil profile gets
 * twice the Telugu/Tamil supply, not a Bollywood-led pool).
 */
import { getProfile } from "./profile";

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

/** Two extra supply seeds per language, for the languages the user actually picked. */
const EXTRA_SEEDS: Partial<Record<Lang, string[]>> = {
  Telugu: ["telugu melody hit songs", "telugu love songs"],
  Tamil: ["tamil melody hit songs", "tamil love songs"],
  Hindi: ["hindi melody hit songs", "hindi love songs"],
  Punjabi: ["punjabi love songs", "new punjabi songs"],
  Kannada: ["kannada melody songs", "kannada love songs"],
  Malayalam: ["malayalam melody songs", "malayalam love songs"],
  Bengali: ["bengali melody songs", "bengali love songs"],
  English: ["pop hits", "top english songs"],
};

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
        // the shared knowledge base + supply seeds for the languages THIS
        // listener selected (their feed pool should breathe Telugu/Tamil, not
        // Bollywood — while the Hindi seeds still teach the detector)
        const seeds = [...SEEDS];
        try {
          const p = getProfile();
          if (p && !p.skipped) {
            for (const l of p.langs) {
              for (const q of EXTRA_SEEDS[l] ?? []) {
                if (!seeds.some((s) => s.q === q)) seeds.push({ q, lang: l });
              }
            }
          }
        } catch {
          /* no profile yet — the shared seeds carry the catalog */
        }
        const all = new Map<string, Track>();
        const results = await Promise.allSettled(
          seeds.map(async ({ q, lang }) => ({ lang, ts: await searchApi(q) })),
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
