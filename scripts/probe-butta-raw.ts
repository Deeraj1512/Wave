/** Probe RAW songs-filter response for "Butta Bomma" — is the original in YouTube's list at all? */
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const API = "https://music.youtube.com/youtubei/v1";
const CLIENT = { name: "WEB_REMIX", version: "1.20260213.01.00", id: "67" };

function collect(node: any, key: string, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 15) return out;
  if (Array.isArray(node)) {
    for (const x of node) collect(x, key, out, depth + 1);
    return out;
  }
  if (node[key]) out.push(node[key]);
  for (const k of Object.keys(node)) collect(node[k], key, out, depth + 1);
  return out;
}
function runsText(obj: any): string {
  if (!obj) return "";
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

async function search(query: string, params?: string) {
  const res = await fetch(`${API}/search?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": CLIENT.id,
      "X-YouTube-Client-Version": CLIENT.version,
      "X-Origin": "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
    },
    body: JSON.stringify({
      context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, gl: "IN", hl: "en" } },
      query,
      ...(params ? { params } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.log("HTTP", res.status);
    return null;
  }
  return res.json();
}

async function dump(query: string, params?: string, label?: string) {
  console.log(`\n=== RAW ${label ?? ""} "${query}" ${params ? "(filtered)" : "(unfiltered)"} ===`);
  const raw = await search(query, params);
  if (!raw) return;
  const items = collect(raw, "musicResponsiveListItemRenderer");
  console.log(`rows: ${items.length}`);
  for (const it of items.slice(0, 14)) {
    const cols: string[] = (it.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    const vid =
      it?.playlistItemData?.videoId ??
      it?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
      it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ?? "";
    const type =
      it?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ??
      it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? "-";
    console.log(`  [${vid}] type=${type} "${cols[0]?.slice(0, 42)}" | ${cols.slice(1).join(" / ").slice(0, 70)}`);
  }
  // album shelf entities too
  const shelfTitles = collect(raw, "musicCarouselShelfRenderer")
    .map((c: any) => runsText(c?.header?.musicCarouselShelfBasicHeaderRenderer?.title))
    .filter(Boolean);
  console.log("  shelves:", shelfTitles);
}

async function main() {
  await dump("Butta Bomma", "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D".replace("%3D", "=").replace("%3D", "="), "SONGS-FILTER");
  await dump("Butta Bomma", undefined, "UNFILTERED");
}
main();
