/** Probe the bare (top) attempt for a query. */
import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "../src/lib/yt/clients";
import { getVisitorData, sessionReady } from "../src/lib/yt/innertube";
import { collectItems } from "../src/lib/yt/search";

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
    }),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await res.json();
  const items = collectItems(raw);
  console.log(`top attempt for "${q}": ${items.length} items`);
  for (const item of items.slice(0, 14)) {
    const cols: string[] = (item.flexColumns ?? []).map((c: any) =>
      c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((r: any) => r.text ?? "").join("") ?? c?.musicResponsiveListItemFlexColumnRenderer?.text?.simpleText ?? ""
    );
    const vid = item?.playlistItemData?.videoId ?? item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ?? "?";
    console.log(`  [${vid}] ${cols.filter(Boolean).join(" | ").slice(0, 140)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
