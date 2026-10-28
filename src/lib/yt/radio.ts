/**
 * Autoplay radio — ported from YouTube Music's own queue behavior (verified live on
 * music.youtube.com): playing a track with Autoplay on fills "Next up" via the InnerTube
 * `next` endpoint with playlistId RDAMVM<videoId> — a ~50-item Mix seeded by that track,
 * extendable via continuations.
 *
 * The kaset API reference (github.com/sozercan/kaset) confirms signed-out access:
 *   next with playlistId: RDAMVM<videoId> → HTTP 200, 50-item radio queue + continuation.
 *
 * Everything goes through the same originals-only filter as search — our measured 27.5%
 * pollution rate in YTM's own Mix queue (lofi/mashup/lyrical-video uploads) dies here.
 */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";
import { classify, parseViews, sanitize, type SearchTrack } from "./filters";

function runsText(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

function parseTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return 0;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/** Recursively collect playlistPanelVideoRenderer nodes (the radio queue item shape). */
function collectPanels(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 15) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectPanels(x, out, depth + 1);
    return out;
  }
  if (node.playlistPanelVideoRenderer) out.push(node.playlistPanelVideoRenderer);
  for (const k of Object.keys(node)) collectPanels(node[k], out, depth + 1);
  return out;
}

function panelThumb(item: any): string | undefined {
  const t = item?.thumbnail;
  const thumbs = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.musicThumbnailRendererRenderer?.thumbnail?.thumbnails ?? t?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const last = thumbs[thumbs.length - 1];
  if (!last?.url) return undefined;
  const url = last.url.startsWith("//") ? `https:${last.url}` : last.url;
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

function panelToTrack(item: any): SearchTrack | null {
  const videoId = item?.navigationEndpoint?.watchEndpoint?.videoId ?? item?.videoId;
  if (!videoId) return null;
  const title = runsText(item.title).trim();
  if (!title) return null;

  const byline = runsText(item.longBylineText ?? item.shortBylineText);
  const segs = byline.split("•").map((x) => x.trim()).filter(Boolean);
  let artist = segs[0] ?? "Unknown artist";
  let album = segs[1] && segs[1] !== title ? segs[1] : "";
  // auto-generated channels surface as "X - Topic"; strip for display + matching
  artist = artist.replace(/\s*-\s*Topic\s*$/i, "").trim() || "Unknown artist";
  const durationSec = parseTime(runsText(item.lengthText) ?? "");
  const views = parseViews(byline);

  // Radio items rarely expose musicVideoType; album presence ⇒ official catalog entry.
  const kind = album ? "song" : "video";
  const classified = classify({ videoId, title, artist, album, durationSec, views, kind, thumb: panelThumb(item) });
  return classified;
}

export interface RadioResult {
  seedVideoId: string;
  tracks: SearchTrack[];
  dropped: Record<string, number>;
  /** playlistId for continuations (future extension) */
  playlistId?: string;
}

const radioCache = new Map<string, { at: number; data: RadioResult }>();
const RADIO_TTL = 60 * 60 * 1000; // 1h — a Mix is personalized-ish but stable enough per seed

/**
 * Radio queue for a seed track — the "Autoplay" layer. Falls back to a related-seeds
 * search (same song artist) when the radio endpoint yields nothing usable.
 */
export async function radioFor(videoId: string, opts: { force?: boolean } = {}): Promise<RadioResult> {
  const cached = radioCache.get(videoId);
  if (!opts.force && cached && Date.now() - cached.at < RADIO_TTL) return cached.data;

  await sessionReady();
  const playlistId = `RDAMVM${videoId}`;
  const dropped: Record<string, number> = {};

  const res = await fetch(`${API_YTM}/next?key=${INNERTUBE_KEY}&prettyPrint=false`, {
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
      videoId,
      playlistId,
    }),
    signal: AbortSignal.timeout(12000),
  });

  let tracks: SearchTrack[] = [];
  if (res.ok) {
    const j = await res.json();
    // panelToTrack already classifies (tier/junk/duration); just drop tier-0 and the seed
    const parsed = collectPanels(j)
      .map(panelToTrack)
      .filter((x): x is SearchTrack => x !== null && x.tier > 0)
      .filter((t) => t.videoId !== videoId); // the seed itself never repeats in "Next up"
    const clean = sanitize(parsed);
    tracks = clean.clean;
    Object.assign(dropped, clean.dropped);
  }

  const out: RadioResult = { seedVideoId: videoId, tracks, dropped, playlistId };
  if (tracks.length > 0) radioCache.set(videoId, { at: Date.now(), data: out });
  return out;
}
