/**
 * Album access — the Innertube surfaces the app was missing.
 *
 * Two endpoints, both against the same WEB_REMIX client every other yt/ module
 * uses (isomorphic: runs in the Next /api routes on web AND in-process in the
 * Capacitor APK where CapacitorHttp makes the fetches CORS-free):
 *
 *  1. searchAlbums(query) — the UNFILTERED /search response carries entity
 *     shelves ("Top result / Songs / Videos / ALBUMS / Artists …"). Our song
 *     parser used to throw album rows away because they carry no videoId —
 *     they carry an MPREb_ browseId instead. This module keeps them.
 *
 *  2. browseAlbum(browseId) — the /browse call for an MPREb_ id returns the
 *     REAL album page: exact title, artist, year, cover and the complete
 *     official tracklist. This is what "tap an album → see the exact album"
 *     is built on (no more fuzzy regrouping of whatever a song search happened
 *     to return).
 */

import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";

// ── tiny shared response helpers (kept local so search.ts stays untouched) ──

function runsText(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

function thumbOf(item: any): string | undefined {
  const t = item?.thumbnail;
  const thumbs = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const last = thumbs[thumbs.length - 1];
  if (!last?.url) return undefined;
  const url = last.url.startsWith("//") ? `https:${last.url}` : last.url;
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

/** Recursively collect musicResponsiveListItemRenderer nodes (depth-capped). */
function collectRows(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 18) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectRows(x, out, depth + 1);
    return out;
  }
  if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
  for (const k of Object.keys(node)) collectRows(node[k], out, depth + 1);
  return out;
}

/** First nested object under `key` anywhere in the tree (headers don't live at
 *  a fixed path — WEB_REMIX nests them inside tab/section structures). */
function collectFirst(node: any, key: string, depth = 0): any | undefined {
  if (!node || typeof node !== "object" || depth > 14) return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const hit = collectFirst(x, key, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node[key]) return node[key];
  for (const k of Object.keys(node)) {
    const hit = collectFirst(node[k], key, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/** MPREb_ browse id on a row (album entities) — null for songs/videos/artists. */
function albumBrowseIdOf(item: any): string | null {
  const nav =
    item?.navigationEndpoint?.browseEndpoint ??
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
  const id: string | undefined = nav?.browseId;
  if (!id) return null;
  const pageType =
    item?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ??
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  if (pageType && pageType !== "MUSIC_PAGE_TYPE_ALBUM") return null;
  return id.startsWith("MPREb_") ? id : null;
}

export interface SearchAlbum {
  browseId: string;
  title: string;
  artist: string;
  /** "2019" when the byline carries it */
  year?: string;
  /** "Album" | "Single" | "EP" when detectable */
  kind?: string;
  thumb?: string;
  /** folded title — the stable key the album registry pages use */
  key: string;
}

const fold = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Parse album-entity rows out of any raw /search response item list. */
export function parseAlbumRows(items: any[]): SearchAlbum[] {
  const out: SearchAlbum[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const browseId = albumBrowseIdOf(item);
    if (!browseId || seen.has(browseId)) continue;
    const cols: string[] = (item.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    const title = cols[0]?.trim() ?? "";
    if (!title) continue;
    // byline segments: "Artist", "Album • Year" / "Artist • Year" / "Artist • Single"
    const segs = cols
      .slice(1)
      .filter(Boolean)
      .flatMap((s) => s.split("•"))
      .map((x) => x.trim())
      .filter(Boolean);
    const year = segs.find((s) => /^\d{4}\b/.test(s));
    const kind = segs.find((s) => /^(single|ep|single-ep)\b/i.test(s));
    const artist = segs.find((s) => s !== year && s !== kind) ?? "";
    seen.add(browseId);
    out.push({
      browseId,
      title,
      artist,
      year: year || undefined,
      kind: kind ? kind.replace(/-ep$/i, "-EP") : undefined,
      thumb: thumbOf(item),
      key: fold(title),
    });
  }
  return out;
}

/** One unfiltered /search POST — the response shape albums live in. */
async function rawSearch(query: string): Promise<any[]> {
  try {
    await sessionReady();
  } catch {
    /* keep going — the POST answers without a visitor id (runSearch parity) */
  }
  let res: Response;
  try {
    res = await fetch(`${API_YTM}/search?key=${INNERTUBE_KEY}&prettyPrint=false`, {
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
      body: JSON.stringify({
        context: {
          client: {
            clientName: WEB_REMIX.name,
            clientVersion: WEB_REMIX.version,
            gl: "IN",
            hl: "en",
            visitorData: getVisitorData() ?? undefined,
          },
        },
        query,
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const raw = await res.json();
  return collectRows(raw);
}

const foldIncludes = (a: string, b: string): boolean => {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return false;
  return fa === fb || (fa.length >= 4 && fb.includes(fa)) || (fb.length >= 4 && fa.includes(fb));
};

/**
 * Album entities for a query, best match first. Matching ranks the query
 * against entity titles (exact ≫ contains) and keeps popularity-neutral
 * order otherwise. Never throws — a dead search answers [].
 */
export async function searchAlbums(query: string): Promise<SearchAlbum[]> {
  const q = fold(query);
  if (!q) return [];
  const items = await rawSearch(query);
  const albums = parseAlbumRows(items);
  const scored = albums.map((a, i) => {
    let s = albums.length - i; // keep source order as the base
    if (foldIncludes(a.title, query)) s += 1000;
    if (a.key === q) s += 500;
    return { a, s };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, 12).map((x) => x.a);
}

/** The best album entity for a query, or null. */
export async function findAlbum(query: string, artist?: string): Promise<SearchAlbum | null> {
  const albums = await searchAlbums(query);
  if (albums.length === 0) return null;
  if (artist) {
    const fa = fold(artist.split(",")[0]);
    const byArtist = albums.find((a) => fa && fold(a.artist).includes(fa));
    if (byArtist) return byArtist;
  }
  return albums[0];
}

// ── exact album page (browse) ─────────────────────────────────────────────────

export interface AlbumTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export interface AlbumDetail {
  browseId: string;
  title: string;
  artist: string;
  year?: string;
  thumb?: string;
  trackCount: number;
  tracks: AlbumTrack[];
}

const detailCache = new Map<string, { at: number; data: AlbumDetail }>();
const DETAIL_TTL = 30 * 60 * 1000; // album tracklists don't change — 30 min is plenty
const inflight = new Map<string, Promise<AlbumDetail | null>>();

function parseTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

function videoIdOf(item: any): string | null {
  return (
    item?.playlistItemData?.videoId ??
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    null
  );
}

/**
 * The exact album page for an MPREb_ browse id — real title/artist/year/cover
 * and the COMPLETE official tracklist. Cached per browseId; never throws.
 */
export async function browseAlbum(browseId: string): Promise<AlbumDetail | null> {
  const id = (browseId || "").trim();
  if (!id.startsWith("MPREb_")) return null;
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL) return hit.data;
  const pending = inflight.get(id);
  if (pending) return pending;

  const p = (async () => {
    try {
      await sessionReady();
    } catch {
      /* keep going — /browse answers without a visitor id too */
    }
    let res: Response;
    try {
      res = await fetch(`${API_YTM}/browse?key=${INNERTUBE_KEY}&prettyPrint=false`, {
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
        body: JSON.stringify({
          context: {
            client: {
              clientName: WEB_REMIX.name,
              clientVersion: WEB_REMIX.version,
              gl: "IN",
              hl: "en",
              visitorData: getVisitorData() ?? undefined,
            },
          },
          browseId: id,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const raw = await res.json();

    // header (either shape, wherever WEB_REMIX nests it this month) — title /
    // subtitle runs / cover
    const header =
      raw?.header?.musicDetailHeaderRenderer ??
      raw?.header?.musicResponsiveHeaderRenderer ??
      collectFirst(raw, "musicDetailHeaderRenderer") ??
      collectFirst(raw, "musicResponsiveHeaderRenderer");
    const title = runsText(header?.title).trim();
    const subSegs: string[] = header?.subtitle ? runsText(header.subtitle).split("•").map((x: string) => x.trim()).filter(Boolean) : [];
    const year = subSegs.find((s) => /^\d{4}\b/.test(s));
    let artist = subSegs.find((s) => s !== year && !/^(single|ep|album|single-ep)$/i.test(s)) ?? "";

    // tracklist — musicPlaylistShelfRenderer (albums) or musicShelfRenderer (singles);
    // album pages carry exactly these shelf rows, so every list item is a track
    const rows = collectRows(raw);
    const tracks: AlbumTrack[] = [];
    const seen = new Set<string>();
    for (const item of rows) {
      const videoId = videoIdOf(item);
      if (!videoId || seen.has(videoId)) continue;
      const cols: string[] = (item.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
      const t = cols[0]?.trim() ?? "";
      if (!t) continue;
      const segs = cols.slice(1).filter(Boolean).flatMap((s) => s.split("•")).map((x) => x.trim()).filter(Boolean);
      const durSeg = segs.find((s) => /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.test(s));
      const artistSeg = segs.find((s) => s !== durSeg && !/^\d{4}\b/.test(s)) ?? artist;
      seen.add(videoId);
      tracks.push({
        videoId,
        title: t,
        artist: artistSeg.replace(/\s*-\s*Topic\s*$/i, "").trim(),
        album: title || "Album",
        durationSec: durSeg ? parseTime(durSeg) : 0,
      });
    }

    if (!title || tracks.length === 0) return null;
    // OST headers often carry no artist ("EP • 2022") — the track credits stand in
    if (!artist) artist = tracks[0]?.artist ?? "";
    const thumb = (header?.thumbnail ? thumbOf(header) : undefined) ?? rows.map((r: any) => thumbOf(r)).find(Boolean);
    const detail: AlbumDetail = {
      browseId: id,
      title,
      artist,
      year: year || undefined,
      thumb,
      trackCount: tracks.length,
      tracks,
    };
    detailCache.set(id, { at: Date.now(), data: detail });
    return detail;
  })();

  inflight.set(id, p);
  const out = await p;
  inflight.delete(id);
  return out;
}

/**
 * One-call resolver the UI + go-to-album use: find the album entity for a
 * name (biased by artist) and return its exact page. Null when YTM has no
 * matching album — callers fall back.
 */
export async function resolveAlbumByName(name: string, artist?: string): Promise<AlbumDetail | null> {
  const entity = await findAlbum(name, artist);
  if (!entity) return null;
  return browseAlbum(entity.browseId);
}
