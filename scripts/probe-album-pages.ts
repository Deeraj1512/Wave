/** Probe album browse: row counts + continuation presence for a big OST album. */
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

async function nextSeed(videoId: string): Promise<string | null> {
  const res = await fetch(`${API}/next?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-YouTube-Client-Name": CLIENT.id, "X-YouTube-Client-Version": CLIENT.version, "X-Origin": "https://music.youtube.com", Referer: "https://music.youtube.com/" },
    body: JSON.stringify({ context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, gl: "IN", hl: "en" } }, videoId, playlistId: `RDAMVM${videoId}` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const raw = await res.json();
  const panels = collect(raw, "playlistPanelVideoRenderer");
  const seed = panels.find((p) => p?.navigationEndpoint?.watchEndpoint?.videoId === videoId) ?? panels[0];
  const runs = [...(seed?.longBylineText?.runs ?? []), ...((seed?.flexColumns ?? []).flatMap((c: any) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []))];
  const albumRun = runs.find((r: any) => r?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("MPREb_"));
  return albumRun?.navigationEndpoint?.browseEndpoint?.browseId ?? null;
}

async function browse(browseId: string) {
  const res = await fetch(`${API}/browse?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-YouTube-Client-Name": CLIENT.id, "X-YouTube-Client-Version": CLIENT.version, "X-Origin": "https://music.youtube.com", Referer: "https://music.youtube.com/" },
    body: JSON.stringify({ context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, gl: "IN", hl: "en" } }, browseId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.log("browse HTTP", res.status);
    return null;
  }
  return res.json();
}

async function main() {
  const bid = await nextSeed("peLhDdjKUWU"); // Samajavaragamana (Ala Vaikunthapurramuloo ATV)
  console.log("album browseId:", bid);
  const raw = await browse(bid!);
  if (!raw) return;
  const header = collect(raw, "musicDetailHeaderRenderer")[0] ?? collect(raw, "musicResponsiveHeaderRenderer")[0];
  console.log("title:", runsText(header?.title), "| subtitle:", runsText(header?.subtitle));
  const rows = collect(raw, "musicResponsiveListItemRenderer");
  console.log("total musicResponsiveListItemRenderer rows:", rows.length);
  const shelf = collect(raw, "musicPlaylistShelfRenderer")[0];
  const shelfRows = shelf ? collect(shelf, "musicResponsiveListItemRenderer") : [];
  console.log("musicPlaylistShelfRenderer rows:", shelfRows.length);
  const conts = collect(raw, "continuationItemRenderer");
  console.log("continuationItemRenderer count:", conts.length);
  if (conts.length) console.log("first continuation token present:", !!conts[0]?.continuationEndpoint?.continuationCommand?.token);
  for (const r of shelfRows.slice(0, 25)) {
    const cols: string[] = (r.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    console.log(`  row: "${cols[0]?.slice(0, 40)}" | ${cols.slice(1).join(" / ").slice(0, 50)}`);
  }
}
main();
