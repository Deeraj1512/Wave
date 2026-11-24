/** Does an entity search on the single's album name find the FULL OST (with the same track)? */
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const API = "https://music.youtube.com/youtubei/v1";
const CLIENT = { name: "WEB_REMIX", version: "1.20260213.01.00", id: "67" };

function collect(node: any, key: string, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== "object" || depth > 15) return out;
  if (Array.isArray(node)) { for (const x of node) collect(x, key, out, depth + 1); return out; }
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
async function post(endpoint: string, body: any) {
  const res = await fetch(`${API}/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-YouTube-Client-Name": CLIENT.id, "X-YouTube-Client-Version": CLIENT.version, "X-Origin": "https://music.youtube.com", Referer: "https://music.youtube.com/" },
    body: JSON.stringify({ context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, gl: "IN", hl: "en" } }, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  return res.ok ? res.json() : null;
}
function albumRows(raw: any) {
  const items = collect(raw, "musicResponsiveListItemRenderer");
  const out: { browseId: string; title: string; byline: string }[] = [];
  for (const it of items) {
    const nav = it?.navigationEndpoint?.browseEndpoint ?? it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
    const bid = nav?.browseId;
    if (!bid || !bid.startsWith("MPREb_")) continue;
    const pt = nav?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? "";
    if (pt && pt !== "MUSIC_PAGE_TYPE_ALBUM") continue;
    const cols: string[] = (it.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    out.push({ browseId: bid, title: cols[0], byline: cols.slice(1).join(" • ") });
  }
  return out;
}
async function main() {
  console.log('search entities "Ala Vaikunthapurramuloo":');
  const raw = await post("search", { query: "Ala Vaikunthapurramuloo" });
  for (const a of albumRows(raw)) console.log("  ", a.browseId, "|", a.title, "|", a.byline);
  // browse the biggest candidate and check track list contains the ATV videoId
  for (const a of albumRows(raw).slice(0, 3)) {
    const b = await post("browse", { browseId: a.browseId });
    if (!b) continue;
    const header = collect(b, "musicDetailHeaderRenderer")[0] ?? collect(b, "musicResponsiveHeaderRenderer")[0];
    const rows = collect(b, "musicResponsiveListItemRenderer");
    const vids = rows.map((r) => r?.playlistItemData?.videoId ?? r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId).filter(Boolean);
    console.log(`\nbrowse ${a.browseId} "${runsText(header?.title)}" subtitle="${runsText(header?.subtitle)}" tracks=${rows.length}`);
    console.log("  contains Samajavaragamana ATV (peLhDdjKUWU)?", vids.includes("peLhDdjKUWU"));
    console.log("  first tracks:", vids.slice(0, 5));
  }
}
main();
