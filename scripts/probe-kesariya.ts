/** Probe Kesariya + Butta Bomma /next rows: all runs + which panel matches the seed. */
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

async function nextRaw(videoId: string) {
  const res = await fetch(`${API}/next?key=${KEY}&prettyPrint=false`, {
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
      videoId,
      playlistId: `RDAMVM${videoId}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  return res.ok ? res.json() : null;
}

async function dump(videoId: string, label: string) {
  console.log(`\n=== ${label} (${videoId}) ===`);
  const raw = await nextRaw(videoId);
  if (!raw) {
    console.log("  next failed");
    return;
  }
  const panels = collect(raw, "playlistPanelVideoRenderer");
  console.log(`  panels: ${panels.length}`);
  const exact = panels.findIndex((p) => p?.navigationEndpoint?.watchEndpoint?.videoId === videoId);
  console.log(`  seed matched at panel index: ${exact}`);
  const seed = panels[exact >= 0 ? exact : 0];
  console.log(`  row used: index ${exact >= 0 ? exact : 0} title="${runsText(seed.title)}" vid=${seed?.navigationEndpoint?.watchEndpoint?.videoId}`);
  const allRuns = [
    ...(seed.longBylineText?.runs ?? []),
    ...((seed.flexColumns ?? []).flatMap((c: any) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])),
  ];
  for (const r of allRuns) {
    const bid = r?.navigationEndpoint?.browseEndpoint?.browseId;
    const pt = r?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? "";
    if (bid) console.log(`  run "${r.text}" → ${bid} (${pt})`);
  }
  // also: first 3 panel titles to understand queue shape
  console.log("  first panels:", panels.slice(0, 3).map((p) => `${runsText(p.title)}@${p?.navigationEndpoint?.watchEndpoint?.videoId}`));
}

async function main() {
  await dump("NJAv_7lHUIU", "Kesariya (search-top ATV)");
  await dump("NRLlSJCWepE", "Butta Bomma (search-top junk?)");
}
main();
