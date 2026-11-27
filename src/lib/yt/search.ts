/**
 * YTM search — raw WEB_REMIX /search POST (same pattern as our earlier proven spike),
 * with the recursive item collector + metadata parsing, feeding the original-only filter.
 *
 * batch18 — the YTM page model. YouTube Music renders a search page from the
 * UNFILTERED ("top") response first: it carries YTM's own TOP-RESULT CARD
 * (musicCardShelfRenderer — the album/artist/song YTM pins above everything),
 * ARTIST entities ("Artist • 382M monthly audience") and ALBUM/SINGLE entities
 * (MPREb_ rows). The filtered songs/videos attempts follow for the LONG list
 * and the weak-query rescue. batch17-and-before fetched the unfiltered attempt
 * LAST and only when the filtered attempts were weak — so Wave never saw the
 * top card or artist entities, and the Albums tab starved ("om" → mantra rows
 * instead of YTM's "O.M: Operation Mole" album card).
 */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";
import { classify, normalizeTitle, parseViews, relevanceRank, relevanceScore, sanitize, type ItemKind, type SearchTrack } from "./filters";
import { parseAlbumRows, type SearchAlbum } from "./album";

// Songs filter param (well-known YTM search filter constant)
const PARAM_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
const PARAM_VIDEOS = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";

const CATEGORY_HINTS = /album|single|ep|playlist|podcast|episode|artist\s?profile|profile/i;
const VIEWS_HINT = /\bviews?\b|\bplays?\b/i;

// Upload-date / relative-age segments YTM sometimes places before the artist run —
// "Oct 18, 2021" or "2 weeks ago" must never become the artist field.
const DATE_LIKE = /^(?:[a-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago)$/i;

// Generic subtitle words YTM puts in the byline slot for non-song rows ("Song", "Video",
// "Single-EP") — none of these is an artist; showing "O Saki Saki by Song" is broken.
const GENERIC_ARTIST = /^(?:songs?|videos?|music|audio|lyrics?|singles?|eps?|albums?|topic|full song|video song|lyrical video)$/i;

/** A named entity (artist / album / song / video) the YTM page pins or lists. */
export type SearchEntityKind = "artist" | "album" | "song" | "video";

export interface SearchEntity {
  kind: SearchEntityKind;
  name: string;
  /** byline under the name — "382M monthly audience", "Sai Abhyankkar • 2026" */
  subtitle: string;
  thumb?: string;
  /** artist (UC…) or album (MPREb…) browse target when the entity has one */
  browseId?: string;
  /** playable id for song/video entities */
  videoId?: string;
}

function parseTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return 0;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/** Recursively collect musicResponsiveListItemRenderer nodes (depth-capped). */
function collectItems(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 15) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectItems(x, out, depth + 1);
    return out;
  }
  if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
  for (const k of Object.keys(node)) collectItems(node[k], out, depth + 1);
  return out;
}

function collectByKey(node: any, key: string, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 18) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectByKey(x, key, out, depth + 1);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === key) out.push(node[k]);
    collectByKey(node[k], key, out, depth + 1);
  }
  return out;
}

function runsText(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

/** Largest square thumbnail on a music list item (real album art), upscaled to 544px. */
function thumbOf(item: any): string | undefined {
  const t = item?.thumbnail;
  const thumbs = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.musicThumbnailRendererRenderer?.thumbnail?.thumbnails ?? t?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const last = thumbs[thumbs.length - 1];
  if (!last?.url) return undefined;
  // YTM thumbs are size-rewritable: =w120-h120-l90-rj → =w544-h544-l90-rj
  const url = last.url.startsWith("//") ? `https:${last.url}` : last.url;
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

/** The first subtitle segment is YTM's own entity label — "Song", "Video", "Artist", "Single"… */
function rowKindHead(item: any): string {
  const col1 = runsText(item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
  return col1.split("•")[0]?.trim() ?? "";
}

function pickVideoId(item: any): string | null {
  return (
    item?.playlistItemData?.videoId ??
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
    item?.navigationEndpoint?.watchEndpoint?.videoId ??
    item?.menu?.menuRenderer?.items?.find((x: any) => x?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId)?.menuNavigationItemRenderer.navigationEndpoint.watchEndpoint.videoId ??
    null
  );
}

function musicVideoTypeOf(item: any): string | null {
  const overlay = item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
  if (overlay?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType) {
    return overlay.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType;
  }
  const btns = item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0];
  const t = btns?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return t ?? null;
}

interface ParsedItem {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  views: number;
  kind: ItemKind;
  thumb?: string;
}

function parseItem(item: any, kindHint?: ItemKind): ParsedItem | null {
  const videoId = pickVideoId(item);
  if (!videoId) return null;
  const cols: string[] = (item.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
  const title = cols[0]?.trim() ?? "";
  if (!title) return null;

  // Real songs-filter shape: col0 = title, col1 = "Artist • Album • 4:29", col2 = "969M plays".
  // Unfiltered ("top") shape: col1 = "Song • Artist • 2026" — the leading "Song"/"Video"
  // word is already in GENERIC_ARTIST, so it never becomes the artist.
  const TIME = /(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
  let durationSec = 0;
  let views = 0;
  let artist = "";
  let album = "";

  const segs: string[][] = cols.slice(1).filter(Boolean).map((s) => s.split("•").map((x) => x.trim()).filter(Boolean));
  for (const segments of segs) {
    for (const seg of segments) {
      if (TIME.test(seg) && durationSec === 0) durationSec = parseTime(seg);
      else if (/views?|plays?/i.test(seg)) views = Math.max(views, parseViews(seg));
      else if (!artist && !DATE_LIKE.test(seg)) artist = seg;
      else if (!album && seg !== title && !DATE_LIKE.test(seg)) album = seg;
    }
  }
  // strip a trailing duration that slipped into artist (e.g. "Artist 4:29"), auto-channel
  // " - Topic", and generic subtitle words ("Song"/"Video") that aren't an artist at all
  artist = artist.replace(/\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/, "").replace(/\s*-\s*Topic\s*$/i, "").trim();
  if (GENERIC_ARTIST.test(artist)) artist = "";
  artist = artist || "Unknown artist";
  const type = musicVideoTypeOf(item);
  let kind: ItemKind = "video";
  if (type === "MUSIC_VIDEO_TYPE_ATV" || type === "MUSIC_VIDEO_TYPE_ARTIST_TRACK") kind = "song";
  else if (type === "MUSIC_VIDEO_TYPE_OMV" || type === "MUSIC_VIDEO_TYPE_UGC") kind = "video";
  else if (kindHint) kind = kindHint;
  else kind = album || views > 0 ? "song" : "video";

  return { videoId, title, artist, album, durationSec, views, kind, thumb: thumbOf(item) };
}

// ── YTM page entities (batch18) ──────────────────────────────────────────────

/** The TOP-RESULT CARD (musicCardShelfRenderer) — YTM's own pick, above every shelf. */
function parseTopCard(raw: any): SearchEntity | null {
  const card = collectByKey(raw, "musicCardShelfRenderer")[0];
  if (!card) return null;
  const name = runsText(card?.title)?.trim();
  if (!name) return null;
  const subtitle = runsText(card?.subtitle)?.trim() ?? "";
  const head = subtitle.split("•")[0]?.trim().toLowerCase();
  const thumb = thumbOf(card);
  // primary navigation: the title run's own endpoint (album → MPREb_, artist → UC_,
  // song → watchEndpoint.videoId); the play buttons carry a watch/watchPlaylist fallback
  const run = card?.title?.runs?.[0]?.navigationEndpoint;
  const browseId: string | undefined = run?.browseEndpoint?.browseId ?? undefined;
  const videoId: string | undefined =
    run?.watchEndpoint?.videoId ??
    collectByKey(card?.buttons, "watchEndpoint")[0]?.videoId ??
    undefined;
  if (head === "artist" && browseId?.startsWith("UC")) {
    return { kind: "artist", name, subtitle: subtitle.split("•").slice(1).join("•").trim(), thumb, browseId };
  }
  if ((head === "album" || head === "single" || head === "ep") && (browseId?.startsWith("MPREb_") || browseId?.startsWith("MPRE"))) {
    return { kind: "album", name, subtitle: subtitle.split("•").slice(1).join("•").trim(), thumb, browseId };
  }
  if ((head === "song" || head === "video") && videoId) {
    return { kind: head === "song" ? "song" : "video", name, subtitle: subtitle.split("•").slice(1).join("•").trim(), thumb, videoId };
  }
  // playlist / profile / podcast / chart cards have no Wave surface — no card at all
  return null;
}

/**
 * ARTIST entities: rows whose byline starts with "Artist •" and whose item-level
 * navigation lands on MUSIC_PAGE_TYPE_ARTIST (browseId UC…). Unfiltered responses
 * carry several ("sid sriram" → Sid Sriram card + A. R. Rahman, Chinmayi…);
 * filtered attempts carry none — artists ride ONLY on the top attempt.
 */
function harvestArtists(items: any[]): SearchEntity[] {
  const out: SearchEntity[] = [];
  const seen = new Set<string>();
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const item of items) {
    const col1 = runsText(item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
    if (!/^artist\b/i.test(col1.trim())) continue;
    const name = runsText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text)?.trim();
    if (!name) continue;
    const nav = item?.navigationEndpoint?.browseEndpoint;
    const pageType = nav?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (pageType && pageType !== "MUSIC_PAGE_TYPE_ARTIST") continue;
    const key = fold(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "artist",
      name,
      subtitle: col1.split("•").slice(1).join("•").trim(), // "382M monthly audience" / ""
      thumb: thumbOf(item),
      browseId: nav?.browseId?.startsWith("UC") ? nav.browseId : undefined,
    });
  }
  return out;
}

export interface SearchResponse {
  query: string;
  tracks: SearchTrack[];
  /** album entities from the response (MPREb_) — the top attempt's rows + any ALBUMS shelf */
  albums: SearchAlbum[];
  /** ARTIST entities YTM returned for this query (top attempt) — feeds the Artists tab */
  artists: SearchEntity[];
  /** YTM's own top-result card — artist/album/song/video, null when none (or playlist junk) */
  top: SearchEntity | null;
  dropped: Record<string, number>;
  attempts: string[];
}

/**
 * How many continuation pages a filtered attempt (songs/videos) may pull behind
 * its first page — this is what makes the result list LONG like YouTube's
 * ("the whole list should appear, not just six or seven songs"). Each page is
 * ~20 raw rows; 3 pages ≈ 60-80 rows before the originals-only filter.
 */
const CONTINUATION_LIMIT = 3;

/**
 * A "browse" query — single token, ≤ 3 chars ("om", "v", "ఓం"). Typing intent can't
 * exist here (no song is two letters), so YTM-style POPULARITY leads: server-side
 * the ranked pool re-orders by play count; client-side tasteRank drops the typed-
 * bucket and lets views decide inside the language lanes.
 */
export function isBrowseQuery(query: string): boolean {
  const nq = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const toks = nq.split(/\s+/).filter((w) => w.length > 0);
  return toks.length === 1 && toks[0].length <= 3;
}

export async function searchOriginals(query: string): Promise<SearchResponse> {
  // dropUgc: search is a LISTENING surface — tier 3 (UGC under 100k views) is
  // exactly the "random unknown songs" the user reported. Radio/stream fallbacks
  // keep tier 3 via searchForSiblings below.
  return runSearch(
    query,
    [
      ["top", undefined],
      ["songs", PARAM_SONGS],
      ["videos", PARAM_VIDEOS],
    ],
    { dropUgc: true }
  );
}

/**
 * Sibling search for stream fallback: unlike searchOriginals (YTM page model),
 * this prefers the VIDEOS filter, which surfaces official music videos on label
 * channels. Discovery (this project): the /player bot-gate is per-video — art
 * tracks are frequently gated from datacenter IPs while the same song's OMV is not.
 */
export async function searchForSiblings(query: string): Promise<SearchResponse> {
  return runSearch(query, [
    ["videos", PARAM_VIDEOS],
    ["top", undefined],
  ]);
}

/**
 * Artists tab data for a query — one unfiltered POST, ARTIST entities only.
 * The main search's response already carries artists (top attempt), but the
 * Artists tab needs a dedicated fetch when the main search short-circuited
 * confident without them or arrived empty.
 */
export async function searchArtistsOnly(query: string): Promise<SearchEntity[]> {
  const raw = await ytmSearchPost({ ...ytmCtx(), query });
  if (!raw) return [];
  const out = harvestArtists(collectItems(raw));
  const card = parseTopCard(raw);
  if (card?.kind === "artist") {
    const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!out.some((a) => fold(a.name) === fold(card.name))) out.unshift(card);
  }
  return out.slice(0, 12);
}

// ── transport (one shared POST for every attempt + the artists-only probe) ──

function ytmCtx() {
  return {
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
}

async function ytmSearchPost(body: Record<string, unknown>): Promise<any | null> {
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
    return null; // network hiccup on this page — the pages we have still answer
  }
}

async function runSearch(
  query: string,
  attemptsSpec: readonly (readonly [string, string | undefined])[],
  opts?: { dropUgc?: boolean }
): Promise<SearchResponse> {
  const albums: SearchAlbum[] = [];
  const artists: SearchEntity[] = [];
  let top: SearchEntity | null = null;
  // Best-effort bootstrap: a dead session (bot wall / offline) must degrade to
  // empty attempts, never throw out of search.
  try {
    await sessionReady();
  } catch {
    /* attempts below answer !ok without a visitor id — empty result, no crash */
  }
  const attempts: string[] = [];
  const dropped: Record<string, number> = {};
  const bump = (k: string) => (dropped[k] = (dropped[k] ?? 0) + 1);

  // Weak-first-attempt fallback merge: YTM's songs filter sometimes misses the actual song
  // for a query entirely ("Butta Bomma" → obscure "Butta" tracks only) while the videos
  // filter has it. If the best result of an attempt shows no verbatim title-phrase match
  // (score < 5000), keep it as partial, try the next attempt and MERGE — then rank once.
  const WEAK_TOP = 5000;
  const merged = new Map<string, SearchTrack>();
  const seenKey = (t: SearchTrack) => normalizeTitle(`${t.title}|${t.artist.split(",")[0]}`);

  for (let i = 0; i < attemptsSpec.length; i++) {
    const [label, params] = attemptsSpec[i];
    attempts.push(label);

    const first = await ytmSearchPost({
      ...ytmCtx(),
      query,
      ...(params ? { params: decodeURIComponent(params) } : {}),
    });
    if (!first) continue;

    const rawItems = collectItems(first);

    if (i === 0 && !params) {
      // ── the TOP (unfiltered) attempt — YTM's page header ──
      // 1) YTM's own top-result card
      const card = parseTopCard(first);
      if (card) {
        top = card;
        // a pinned album is also a real album entity — the Albums tab gets it too
        if (card.kind === "album" && card.browseId && !albums.some((x) => x.browseId === card.browseId)) {
          const year = card.subtitle.match(/\b(19|20)\d{2}\b/)?.[0];
          albums.unshift({ browseId: card.browseId, title: card.name, artist: card.subtitle.replace(/\s*[•|]\s*(19|20)\d{2}\s*$/, "").trim(), year, key: card.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim() });
        }
        if (card.kind === "artist") {
          const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
          if (!artists.some((a) => fold(a.name) === fold(card.name))) artists.unshift(card);
        }
      }
      // 2) ARTIST entities (only the top attempt carries them)
      for (const a of harvestArtists(rawItems)) {
        const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!artists.some((x) => fold(x.name) === fold(a.name))) artists.push(a);
      }
      if (artists.length > 12) artists.length = 12;
      // 3) album/single entity rows (row-level MPREb_ navigation)
      if (albums.length < 12) {
        for (const a of parseAlbumRows(rawItems)) {
          if (!albums.some((x) => x.browseId === a.browseId)) albums.push(a);
        }
      }
      // 4) only "Song"-labelled rows join the track pool — Video rows are the
      //    videos attempt's job (its junk machinery is proven), everything else
      //    (Episode/Playlist/Profile/Podcast) is not a track at all
      const songRows = rawItems.filter((it) => /^song\b/i.test(rowKindHead(it)));
      const parsed = songRows.map((it) => parseItem(it, "song")).filter((x): x is ParsedItem => x !== null);
      const classified = parsed.map(classify);
      const { clean } = sanitize(classified);
      for (const t of clean) {
        const byId = merged.get(t.videoId);
        const key = seenKey(t);
        const dupKey = [...merged.values()].find((m) => seenKey(m) === key);
        if (byId) {
          if (t.tier < byId.tier || (t.tier === byId.tier && t.views > byId.views)) merged.set(t.videoId, t);
        } else if (dupKey) {
          if (t.tier < dupKey.tier || (t.tier === dupKey.tier && t.views > dupKey.views)) merged.set(dupKey.videoId, t);
        } else {
          merged.set(t.videoId, t);
        }
      }
      // never stop at the top attempt alone — the songs attempt brings the long list
      continue;
    }

    // album entities ride along in the FIRST page (the ALBUMS shelf) — free
    // access, no second request; continuations don't carry shelves
    if (albums.length < 12) {
      for (const a of parseAlbumRows(collectItems(first))) {
        if (!albums.some((x) => x.browseId === a.browseId)) albums.push(a);
      }
    }

    // LONG LIST — follow the continuation chain of filtered attempts so the
    // result list goes on like YouTube's instead of stopping at one page.
    let cont = params ? nextContinuationOf(first) : null;
    for (let p = 0; cont && p < CONTINUATION_LIMIT; p++) {
      const next = await ytmSearchPost({ ...ytmCtx(), continuation: cont });
      if (!next) break;
      rawItems.push(...collectItems(next));
      cont = nextContinuationOf(next);
    }

    const parsed = rawItems.map((it) => parseItem(it)).filter((x): x is ParsedItem => x !== null);
    const classified = parsed.map(classify);
    const { clean } = sanitize(classified);
    for (const [k, v] of Object.entries(classifiedDrops(classified))) bump(k);

    for (const t of clean) {
      const byId = merged.get(t.videoId);
      const key = seenKey(t);
      const dupKey = [...merged.values()].find((m) => seenKey(m) === key);
      if (byId) {
        if (t.tier < byId.tier || (t.tier === byId.tier && t.views > byId.views)) merged.set(t.videoId, t);
      } else if (dupKey) {
        if (t.tier < dupKey.tier || (t.tier === dupKey.tier && t.views > dupKey.views)) merged.set(dupKey.videoId, t);
      } else {
        merged.set(t.videoId, t);
      }
    }

    if (merged.size === 0) continue;
    const pool = opts?.dropUgc ? [...merged.values()].filter((t) => t.tier > 0 && t.tier < 3) : [...merged.values()];
    const ranked = relevanceRank(pool, query);
    const topItem = ranked[0];
    const topScore = topItem ? relevanceScore(topItem, query) : 0;
    // Artist-led queries legitimately have low TITLE scores ("Sid Sriram" → his songs).
    // If the top result strongly matches the query as an artist, never merge further —
    // otherwise the videos attempt floods results with UGC junk titled "<artist> live".
    const nq = normalizeTitle(query).toLowerCase();
    const na = foldArtist(topItem?.artist ?? "");
    const qToks = nq.split(" ").filter((w) => w.length > 1);
    const artistStrong =
      na.length > 0 &&
      (na === nq ||
        na.startsWith(nq) ||
        (qToks.length > 0 && qToks.every((w) => na.includes(w))));
    // Confident short-circuit needs BOTH a phrase match AND real popularity: a 0-view
    // exact-title ATV ("doli doli" → Indonesian folk track) isn't proof the actual hit
    // isn't in the videos attempt — merging lets the views tiebreak pick the right one.
    const confident = topScore >= WEAK_TOP && (topItem?.views ?? 0) >= 50_000;
    if (confident || artistStrong || i === attemptsSpec.length - 1) {
      return finalize(pool, query, albums, artists, top, dropped, attempts);
    }
    // weak top result → fall through and merge the next attempt's results
  }
  // every attempt dead/weak → whatever the pool holds (likely top-attempt songs only)
  const pool = opts?.dropUgc ? [...merged.values()].filter((t) => t.tier > 0 && t.tier < 3) : [...merged.values()];
  return finalize(pool, query, albums, artists, top, dropped, attempts);
}

/** Rank once, apply the browse-query popularity lead, and ship with entities. */
function finalize(
  pool: SearchTrack[],
  query: string,
  albums: SearchAlbum[],
  artists: SearchEntity[],
  top: SearchEntity | null,
  dropped: Record<string, number>,
  attempts: string[]
): SearchResponse {
  const ranked = relevanceRank(pool, query);
  // Browse queries ("om", "v") have no typing intent — YTM-style popularity leads.
  // Stable sort keeps relevance as the tiebreak inside equal play counts.
  const ordered = isBrowseQuery(query) ? [...ranked].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)) : ranked;
  // rel: the query-match score rides along so the client can apply TASTE
  // re-ranking without ever letting taste override a relevance tier
  const withRel = ordered.map((t) => ({ ...t, rel: relevanceScore(t, query) }));
  return { query, tracks: withRel, albums, artists, top, dropped, attempts };
}

/**
 * The next-page token of a search response. The token hides in different
 * renderers per shape (first page: musicShelfRenderer.continuations; following
 * pages: continuationContents.musicShelfContinuation…) — a recursive scan for
 * nextContinuationData covers every shape without coupling to one layout.
 */
function nextContinuationOf(raw: any): string | null {
  let found: string | null = null;
  const scan = (node: any, d: number) => {
    if (found || !node || typeof node !== "object" || d > 20) return;
    if (Array.isArray(node)) {
      for (const x of node) scan(x, d + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === "nextContinuationData") {
        const c = node[k]?.continuation;
        if (typeof c === "string" && c.length > 0) found = c;
        return;
      }
      scan(node[k], d + 1);
    }
  };
  scan(raw, 0);
  return found;
}

function classifiedDrops(classified: SearchTrack[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of classified) if (t.tier === 0) out[t.dropReason ?? "unknown"] = (out[t.dropReason ?? "unknown"] ?? 0) + 1;
  return out;
}

/** Same folding as filters.fold (diacritics-strip + lowercase) — kept local to avoid coupling. */
function foldArtist(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
