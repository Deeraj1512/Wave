/* Probe: do official MUSIC VIDEOS (OMV, non-art-track) stream tokenless via IOS? */
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const UA_IOS = "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)";

async function visitor() {
  const html = await (await fetch("https://music.youtube.com/", { headers: { "User-Agent": UA_WEB } })).text();
  return html.match(/"visitorData":"([^"]+)"/)?.[1];
}

async function searchVideos(q: string, vis: string) {
  const res = await fetch(`https://music.youtube.com/youtubei/v1/search?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "67",
      "X-YouTube-Client-Version": "1.20260213.01.00",
      "X-Origin": "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      "User-Agent": UA_WEB,
      "X-Goog-Visitor-Id": vis,
    },
    body: JSON.stringify({ context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20260213.01.00", gl: "IN", hl: "en", visitorData: vis } }, query: q }),
  });
  const j = await res.json();
  const items: any[] = [];
  (function collect(n: any, d: number) {
    if (!n || typeof n !== "object" || d > 15) return;
    if (Array.isArray(n)) return n.forEach((x: any) => collect(x, d + 1));
    if (n.musicResponsiveListItemRenderer) items.push(n.musicResponsiveListItemRenderer);
    Object.values(n).forEach((v: any) => collect(v, d + 1));
  })(j, 0);
  const out: Array<{ id: string; title: string; type: string }> = [];
  for (const it of items) {
    const id =
      it?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
      it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
    if (!id) continue;
    const title = it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? "?";
    const type =
      it?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ??
      it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ??
      "none";
    out.push({ id, title: title.slice(0, 40), type });
  }
  return out;
}

async function playerIOS(vid: string, vis: string) {
  const res = await fetch(`https://music.youtube.com/youtubei/v1/player?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Format-Version": "1",
      "X-YouTube-Client-Name": "5",
      "X-YouTube-Client-Version": "21.03.1",
      "X-Origin": "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      "User-Agent": UA_IOS,
      "X-Goog-Visitor-Id": vis,
    },
    body: JSON.stringify({
      context: { client: { clientName: "IOS", clientVersion: "21.03.1", gl: "IN", hl: "en", osName: "iOS", osVersion: "18.2.22C152", visitorData: vis } },
      videoId: vid,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(9000),
  });
  const j = await res.json();
  const fmts = j?.streamingData?.adaptiveFormats ?? [];
  const audio = fmts.filter((f: any) => (f.mimeType ?? "").startsWith("audio/"));
  return { status: j?.playabilityStatus?.status, plain: audio.filter((f: any) => f.url).length, total: audio.length };
}

async function main() {
  const vis = await visitor();
  const items = await searchVideos("kesariya official video", vis);
  const omvs = items.filter((i) => i.type === "MUSIC_VIDEO_TYPE_OMV").slice(0, 3);
  const ugcs = items.filter((i) => i.type === "MUSIC_VIDEO_TYPE_UGC").slice(0, 2);
  console.log("found OMVs:", omvs.length, "UGCs:", ugcs.length);
  for (const o of [...omvs, ...ugcs]) {
    const r = await playerIOS(o.id, vis);
    console.log(`${o.type.padEnd(22)} ${o.title.padEnd(42)} ${r.status} audioFmt=${r.plain}/${r.total}`);
  }
}
main();
