/**
 * YTM search — raw WEB_REMIX /search POST (same pattern as our earlier proven spike),
 * with the recursive item collector + metadata parsing, feeding the original-only filter.
 */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";
import { classify, normalizeTitle, parseViews, relevanceRank, relevanceScore, sanitize, type ItemKind, type SearchTrack } from "./filters";

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

function runsText(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
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

function parseItem(item: any): ParsedItem | null {
  const videoId = pickVideoId(item);
  if (!videoId) return null;
  const cols: string[] = (item.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
  const title = cols[0]?.trim() ?? "";
  if (!title) return null;

  // Real songs-filter shape: col0 = title, col1 = "Artist • Album • 4:29", col2 = "969M plays".
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
  else kind = album || views > 0 ? "song" : "video";

  return { videoId, title, artist, album, durationSec, views, kind, thumb: thumbOf(item) };
}

export interface SearchResponse {
  query: string;
  tracks: SearchTrack[];
  dropped: Record<string, number>;
  attempts: string[];
}

export async function searchOriginals(query: string): Promise<SearchResponse> {
  return runSearch(query, [
    ["songs", PARAM_SONGS],
    ["videos", PARAM_VIDEOS],
    ["top", undefined],
  ]);
}

/**
 * Sibling search for stream fallback: unlike searchOriginals (songs filter first — art tracks
 * only), this prefers the VIDEOS filter, which surfaces official music videos on label channels.
 * Discovery (this project): the /player bot-gate is per-video — art tracks are frequently gated
 * from datacenter IPs while the same song's OMV is not.
 */
export async function searchForSiblings(query: string): Promise<SearchResponse> {
  return runSearch(query, [
    ["videos", PARAM_VIDEOS],
    ["top", undefined],
  ]);
}

async function runSearch(query: string, attemptsSpec: readonly (readonly [string, string | undefined])[]): Promise<SearchResponse> {
  await sessionReady();
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
          ...(params ? { params: decodeURIComponent(params) } : {}),
        }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      continue; // network hiccup on this attempt — try the next one
    }
    if (!res.ok) continue;

    const raw = await res.json();
    const items = collectItems(raw);
    const parsed = items.map(parseItem).filter((x): x is ParsedItem => x !== null);
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
    const ranked = relevanceRank([...merged.values()], query);
    const top = ranked[0];
    const topScore = top ? relevanceScore(top, query) : 0;
    // Artist-led queries legitimately have low TITLE scores ("Sid Sriram" → his songs).
    // If the top result strongly matches the query as an artist, never merge further —
    // otherwise the videos attempt floods results with UGC junk titled "<artist> live".
    const nq = normalizeTitle(query).toLowerCase();
    const na = foldArtist(top?.artist ?? "");
    const qToks = nq.split(" ").filter((w) => w.length > 1);
    const artistStrong =
      na.length > 0 &&
      (na === nq ||
        na.startsWith(nq) ||
        (qToks.length > 0 && qToks.every((w) => na.includes(w))));
    // Confident short-circuit needs BOTH a phrase match AND real popularity: a 0-view
    // exact-title ATV ("doli doli" → Indonesian folk track) isn't proof the actual hit
    // isn't in the videos attempt — merging lets the views tiebreak pick the right one.
    const confident = topScore >= WEAK_TOP && (top?.views ?? 0) >= 50_000;
    if (confident || artistStrong || i === attemptsSpec.length - 1) {
      return { query, tracks: ranked, dropped, attempts };
    }
    // weak top result → fall through and merge the next attempt's results
  }
  return { query, tracks: [], dropped, attempts };
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
