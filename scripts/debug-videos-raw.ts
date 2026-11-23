/** Dump raw parsed+classified items from the VIDEOS filter (incl. dropped) for a query. */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "../src/lib/yt/clients";
import { getVisitorData, sessionReady } from "../src/lib/yt/innertube";
import { classify, parseViews } from "../src/lib/yt/filters";

const PARAM_VIDEOS = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";

function collectItems(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 15) return out;
  if (Array.isArray(node)) { for (const x of node) collectItems(x, out, depth + 1); return out; }
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
function parseTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!m) return 0;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}
function pickVideoId(item: any): string | null {
  return (
    item?.playlistItemData?.videoId ??
    item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
    item?.navigationEndpoint?.watchEndpoint?.videoId ?? null
  );
}
function musicVideoTypeOf(item: any): string | null {
  const overlay = item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;
  if (overlay?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType) {
    return overlay.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType;
  }
  const btns = item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0];
  return btns?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? null;
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
function parseItem(item: any) {
  const videoId = pickVideoId(item);
  if (!videoId) return null;
  const cols: string[] = (item.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
  const title = cols[0]?.trim() ?? "";
  if (!title) return null;
  const TIME = /(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
  let durationSec = 0, views = 0, artist = "", album = "";
  const segs: string[][] = cols.slice(1).filter(Boolean).map((s) => s.split("•").map((x: string) => x.trim()).filter(Boolean));
  for (const segments of segs) {
    for (const seg of segments) {
      if (TIME.test(seg) && durationSec === 0) durationSec = parseTime(seg);
      else if (/views?|plays?/i.test(seg)) views = Math.max(views, parseViews(seg));
      else if (!artist) artist = seg;
      else if (!album && seg !== title) album = seg;
    }
  }
  artist = artist.replace(/\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/, "").trim() || "Unknown artist";
  const type = musicVideoTypeOf(item);
  let kind: "song" | "video" | "other" = "video";
  if (type === "MUSIC_VIDEO_TYPE_ATV" || type === "MUSIC_VIDEO_TYPE_ARTIST_TRACK") kind = "song";
  else if (type === "MUSIC_VIDEO_TYPE_OMV" || type === "MUSIC_VIDEO_TYPE_UGC") kind = "video";
  else kind = album || views > 0 ? "song" : "video";
  return { videoId, title, artist, album, durationSec, views, kind, thumb: thumbOf(item) };
}

async function main() {
  const q = process.argv[2] ?? "Butta Bomma";
  await sessionReady();
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
    body: JSON.stringify({
      context: { client: { clientName: WEB_REMIX.name, clientVersion: WEB_REMIX.version, gl: "IN", hl: "en", visitorData: getVisitorData() ?? undefined } },
      query: q,
      params: decodeURIComponent(PARAM_VIDEOS),
    }),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await res.json();
  const items = collectItems(raw);
  console.log(`videos filter for "${q}": ${items.length} raw items`);
  for (const item of items) {
    const p = parseItem(item);
    if (!p) { console.log("  [unparseable]"); continue; }
    const c = classify(p as any);
    const v = p.views >= 1e6 ? Math.round(p.views / 1e6) + "M" : Math.round(p.views / 1e3) + "K";
    console.log(`  [t${c.tier}${c.dropReason ? " " + c.dropReason : ""}] "${p.title}" — ${p.artist} | ${v}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
