/**
 * Real artist PHOTOS — the fix for "song profile instead of artist Face".
 *
 * The Radio shelf / onboarding circles used to show the artist's top SONG's
 * album art (movie posters — Raees behind Arijit Singh, Remo behind Anirudh).
 * This module resolves the artist's own portrait instead, cheapest source first:
 *
 *   1. YouTube Music artist search — rows whose navigation lands on
 *      MUSIC_PAGE_TYPE_ARTIST carry the channel's avatar, which for music
 *      artist channels IS the artist's face. Tried with the dedicated
 *      ARTISTS filter param first, then an unfiltered scan as fallback.
 *   2. Deezer artist search (no API key needed) — picture_xl is a real
 *      press photo for nearly every mainstream artist, including Indian ones.
 *
 * Isomorphic: runs on the Node server (/api/artist-img) AND inside the APK
 * (CapacitorHttp fetch, no CORS). Resolution result is cached by the CALLER
 * (artistCatalog persists to localStorage) — this module only memoizes
 * in-process for the server's lifetime.
 */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";

/** Diacritic-strip + lowercase + whitespace collapse — same matching key everywhere. */
export function foldName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The dedicated ARTISTS search filter param (same family as our songs/videos params). */
const PARAM_ARTISTS = "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D";

function runsText(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

/** Largest square thumbnail on a node, upscaled to 544px (YTM thumbs are size-rewritable). */
function nodeThumb(item: any): string | undefined {
  const t = item?.thumbnail;
  const thumbs =
    t?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    t?.musicThumbnailRendererRenderer?.thumbnail?.thumbnails ??
    t?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const last = thumbs[thumbs.length - 1];
  if (!last?.url) return undefined;
  const url = last.url.startsWith("//") ? `https:${last.url}` : last.url;
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

/** Does this navigation land on a music ARTIST page — EXPLICIT pageType only.
 *  Used on the UNFILTERED lane, where any kind of channel can appear (a "Chill
 *  Lofi" UGC channel once posed as an artist under a bare-UC… shape rule). */
function isArtistEndpoint(ep: any): boolean {
  const pageType =
    ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ??
    ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.musicPageType;
  return typeof pageType === "string" && /ARTIST/i.test(pageType);
}

/** Recursively collect every renderer we care about, depth-capped. */
function collectRenderers(node: any, kind: string, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 18) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectRenderers(x, kind, out, depth + 1);
    return out;
  }
  if (node[kind]) out.push(node[kind]);
  for (const k of Object.keys(node)) collectRenderers(node[k], kind, out, depth + 1);
  return out;
}

/**
 * Scan a search response for the ARTIST entity that matches `name` — STRICT:
 * only rows/cards that navigate to MUSIC_PAGE_TYPE_ARTIST, and only when the
 * row title IS the artist name (exact folded match, or the full query phrase
 * inside the title / title inside the query with every word present). Loose
 * token matching once let a "Chill Lofi" UGC channel pose as "Revanth".
 * Returns the biggest square avatar found (the face) or undefined.
 */
function artistPhotoFromResponse(raw: any, name: string, requirePageType: boolean): string | undefined {
  const target = foldName(name);
  if (!target) return undefined;
  const targetWords = target.split(" ").filter((w) => w.length >= 2);
  type Cand = { title: string; thumb: string; exact: boolean; audience: number; order: number };
  const cands: Cand[] = [];

  /** "8.1K subscribers" / "144M monthly audience" → the audience size (0 = unknown). */
  const audienceOf = (item: any): number => {
    const sub =
      runsText(item?.subtitle) ||
      runsText(item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
      "";
    const m = /([\d.]+)\s*([KMB])?\s*(?:subscribers?|monthly\s+audience|listeners?)/i.exec(sub);
    if (!m) return 0;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ""] ?? 1;
    return Math.round(parseFloat(m[1]) * mult);
  };

  const titleMatches = (title: string): boolean => {
    const ft = foldName(title);
    if (ft === target) return true;
    if (target.length >= 4 && ft.includes(target)) return true;
    // every query word present in the title (handles "A.R. Rahman" vs "A R Rahman")
    if (targetWords.length > 0 && targetWords.every((w) => ft.includes(w))) return true;
    return false;
  };

  const scanRow = (item: any, order: number) => {
    const thumb = nodeThumb(item);
    if (!thumb) return;
    const title =
      runsText(item?.title) ||
      runsText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
      "";
    if (!title) return;
    const navs = collectRenderers(item, "navigationEndpoint");
    const ok = navs.some((n) => {
      const ep = n?.navigationEndpoint ?? n;
      const be = ep?.browseEndpoint;
      if (!be?.browseId || ep?.watchEndpoint) return false; // watch = a song, never an artist
      if (requirePageType) return isArtistEndpoint(ep);
      // FILTERED lane: the ARTISTS search filter guarantees every row is an artist
      // entity — measured: rows carry a bare browseEndpoint (UC…/VA…) with NO pageType
      return /^(UC|VA)/.test(be.browseId);
    });
    if (!ok) return;
    if (!titleMatches(title)) return;
    cands.push({ title, thumb, exact: foldName(title) === target, audience: audienceOf(item), order });
  };

  const cards = collectRenderers(raw, "musicCardShelfRenderer");
  cards.forEach((c, i) => scanRow(c, i));
  const rows = collectRenderers(raw, "musicResponsiveListItemRenderer");
  rows.forEach((r, i) => scanRow(r, cards.length + i));

  if (cands.length === 0) return undefined;
  // POPULARITY decides, with an exact-name bonus — a 729-subscriber channel named
  // "Revanth" must NEVER beat L. V. Revanth (8.1K subs, the real playback singer):
  // score = audience × (exact-name ×3). Exact matches usually win outright; a big
  // real artist under a longer name ("L.V. Revanth" for "Revanth") outranks a
  // tiny impostor with the exact same name.
  cands.sort((a, b) => b.audience * (b.exact ? 3 : 1) - a.audience * (a.exact ? 3 : 1) || a.order - b.order);
  return cands[0].thumb;
}

async function postSearch(body: Record<string, unknown>): Promise<any | null> {
  try {
    const res = await fetch(`${API_YTM}/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": WEB_REMIX.id,
        "X-YouTube-Client-Version": WEB_REMIX.version,
        "X-Origin": "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": WEB_REMIX.userAgent,
        ...(getVisitorData() ? { "X-Goog-Visitor-Id": getVisitorData()! } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const ytmCache = new Map<string, string | null>(); // key = folded name (+! for the unfiltered lane)
let sessionTried = false;

/**
 * YouTube Music's own artist avatar. `unfiltered = false`: ONLY the dedicated
 * ARTISTS-filter search (every row is a real artist entity). `unfiltered = true`:
 * the plain search scan with the same strict matching — the drift-proof catch-all.
 * Split into two lanes so Deezer's clean press photos sit between them.
 */
async function ytmArtistPhoto(name: string, unfiltered = false): Promise<string | undefined> {
  const key = `${foldName(name)}${unfiltered ? "!" : ""}`;
  if (ytmCache.has(key)) return ytmCache.get(key) ?? undefined;
  if (!sessionTried) {
    sessionTried = true;
    try {
      await sessionReady();
    } catch {
      /* search answers !ok without a visitor id — still worth the attempt */
    }
  }
  const ctx = {
    context: {
      client: {
        clientName: WEB_REMIX.name,
        clientVersion: WEB_REMIX.version,
        gl: "IN",
        hl: "en",
        visitorData: getVisitorData() ?? undefined,
      },
    },
  };
  const raw = unfiltered
    ? await postSearch({ ...ctx, query: name })
    : await postSearch({ ...ctx, query: name, ...(PARAM_ARTISTS ? { params: decodeURIComponent(PARAM_ARTISTS) } : {}) });
  const photo = raw ? artistPhotoFromResponse(raw, name, unfiltered) : undefined;
  ytmCache.set(key, photo ?? null);
  return photo;
}

const deezerCache = new Map<string, string | null>();

/** Source 2 — Deezer artist press photo (no API key, generous CORS). */
async function deezerArtistPhoto(name: string, exactOnly = false): Promise<string | undefined> {
  const key = `${foldName(name)}${exactOnly ? "!" : ""}`;
  if (deezerCache.has(key)) return deezerCache.get(key) ?? undefined;
  try {
    const res = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=6`,
      { signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) throw new Error(`deezer ${res.status}`);
    const j = (await res.json()) as { data?: Array<{ name?: string; picture_xl?: string; picture_big?: string }> };
    const list = j.data ?? [];
    const target = foldName(name);
    const best = exactOnly
      ? list.find((a) => foldName(a.name ?? "") === target)
      : list.find((a) => foldName(a.name ?? "") === target) ??
        list.find((a) => (a.name ?? "").toLowerCase().includes(target) && target.length >= 4) ??
        list[0];
    const url = best?.picture_xl || best?.picture_big || undefined;
    deezerCache.set(key, url ?? null);
    return url;
  } catch {
    deezerCache.set(key, null);
    return undefined;
  }
}

const wikiCache = new Map<string, string | null>();
const MUSICIAN_HINT =
  /\b(singer|playback|composer|music(?:ian| director)|vocalist|lyricist|actor|film score|discography)\b/i;

/**
 * Source 3 — Wikidata/Wikipedia portrait. Notable artists carry a P18 image on
 * Wikidata (the same photograph their Wikipedia infobox uses) — a real press
 * face, CORS-open and keyless. Only accepted when the entity's description
 * smells musical (a wrong "Revanth" village page has no such hint).
 */
async function wikidataPhoto(name: string): Promise<string | undefined> {
  const key = foldName(name);
  if (wikiCache.has(key)) return wikiCache.get(key) ?? undefined;
  try {
    const s = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=5&format=json&origin=*`,
      { signal: AbortSignal.timeout(9000) }
    );
    if (!s.ok) throw new Error(`wikidata ${s.status}`);
    const sj = (await s.json()) as { search?: Array<{ id?: string; description?: string }> };
    const hits = (sj.search ?? []).filter(
      (h) => h.id && h.description && MUSICIAN_HINT.test(h.description)
    );
    for (const h of hits.slice(0, 3)) {
      try {
        const r = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${h.id}&property=P18&format=json&origin=*`,
          { signal: AbortSignal.timeout(9000) }
        );
        if (!r.ok) continue;
        const cj = (await r.json()) as { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> };
        const file = cj.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (typeof file === "string" && file.length > 0) {
          const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=544`;
          wikiCache.set(key, url);
          return url;
        }
      } catch {
        /* next candidate */
      }
    }
    wikiCache.set(key, null);
    return undefined;
  } catch {
    wikiCache.set(key, null);
    return undefined;
  }
}

/**
 * The artist's FACE — YTM avatar first (what the app shows in circles),
 * Deezer press photo second. undefined = both sources came up empty
 * (caller falls back to song art / a plain glyph).
 */
export async function artistPhoto(name: string): Promise<string | undefined> {
  if (!name || !name.trim()) return undefined;
  // 1. Deezer's press photo — real faces for mainstream artists; geo-blocked or
  //    missing coverage degrades cleanly to the lanes below
  const press = await deezerArtistPhoto(name, true);
  if (press) return press;
  // 2. the Wikidata/Wikipedia portrait — a real press photograph for every
  //    notable artist (Kaala Bhairava's YTM avatar can be his latest single's
  //    art; his Wikipedia infobox photo is always his face)
  const wiki = await wikidataPhoto(name);
  if (wiki) return wiki;
  // 3. the dedicated ARTISTS-filter pass — every row is a REAL artist entity,
  //    popularity-ranked (8.1K-sub L. V. Revanth beats a 729-sub impostor)
  const face = await ytmArtistPhoto(name);
  if (face) return face;
  // 4. unfiltered YTM scan (same STRICT matching) — catches artists the filter misses
  const loose = await ytmArtistPhoto(name, true);
  if (loose) return loose;
  // 5. Deezer's best guess — only when the exact-name pass had nothing
  return await deezerArtistPhoto(name, false);
}
