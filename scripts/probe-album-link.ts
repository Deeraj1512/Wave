/**
 * PROBE — song→album linkage via the InnerTube `next` endpoint.
 *
 * Goal: prove that the watch-next queue item for an EXACT videoId carries the
 * album (name and ideally an MPREb_ browseId) — YouTube's own linkage, no name
 * guessing. Test case: "Chitti" from the movie Jathiratnalu (the user's report:
 * Go-to-album resolved some OTHER song named "Chitti").
 *
 * Steps:
 *  1. /search (songs filter) "Chitti Jathiratnalu" → videoId + parsed byline
 *  2. /next { videoId, playlistId: RDAMVM<id> } → find the SEED panel item →
 *     dump its longBylineText runs WITH navigationEndpoints
 *  3. If an MPREb_ browseId rides on the album run → /browse → album title + tracks
 *  4. Also probe /next WITHOUT playlistId (pure videoId) for the same linkage
 */
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const API = "https://music.youtube.com/youtubei/v1";
const CLIENT = { name: "WEB_REMIX", version: "1.20260213.01.00", id: "67" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const ctx = () => ({
  context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, gl: "IN", hl: "en" } },
});

async function post(endpoint: string, body: any): Promise<any | null> {
  try {
    const res = await fetch(`${API}/${endpoint}?key=${KEY}&prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": CLIENT.id,
        "X-YouTube-Client-Version": CLIENT.version,
        "X-Origin": "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": UA,
      },
      body: JSON.stringify({ ...ctx(), ...body }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`  !! ${endpoint} HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`  !! ${endpoint} threw: ${(e as Error).message}`);
    return null;
  }
}

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
  if (typeof obj === "string") return obj;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  if (obj.simpleText) return obj.simpleText;
  return "";
}

async function main() {
  // ── step 1: find the Jathiratnalu Chitti videoId ──────────────────────────
  console.log("STEP 1: search songs filter 'Chitti Jathiratnalu'");
  const s = await post("search", { query: "Chitti Jathiratnalu", params: "EgWKAQIIAWoKEAkQBRAKEAMQBA==" });
  if (!s) return;
  const items = collect(s, "musicResponsiveListItemRenderer");
  console.log(`  rows: ${items.length}`);
  let videoId = "";
  for (const it of items.slice(0, 6)) {
    const cols: string[] = (it.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    const vid =
      it?.playlistItemData?.videoId ??
      it?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
      "";
    console.log(`  - [${vid}] "${cols[0]}" | byline: ${cols.slice(1).join(" / ")}`);
    if (!videoId && vid) videoId = vid;
  }
  if (!videoId) {
    console.log("  no videoId found — abort");
    return;
  }
  console.log(`  seed videoId: ${videoId}`);

  // ── step 2: next WITH playlistId (radio shape radio.ts already uses) ──────
  for (const mode of ["with-playlistId", "videoId-only"]) {
    console.log(`\nSTEP 2 [${mode}]: next for ${videoId}`);
    const body =
      mode === "with-playlistId"
        ? { videoId, playlistId: `RDAMVM${videoId}` }
        : { videoId };
    const n = await post("next", body);
    if (!n) continue;
    const panels = collect(n, "playlistPanelVideoRenderer");
    console.log(`  queue panel items: ${panels.length}`);
    // find the seed item (same videoId)
    const seed = panels.find((p) => p?.navigationEndpoint?.watchEndpoint?.videoId === videoId) ?? panels[0];
    if (!seed) {
      console.log("  no panel items — this shape is empty");
      continue;
    }
    const cols: string[] = (seed.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
    console.log(`  seed title: ${runsText(seed.title)}`);
    console.log(`  seed byline text: ${runsText(seed.longBylineText)}`);
    console.log("  seed longBylineText runs (text + nav):");
    for (const r of seed.longBylineText?.runs ?? []) {
      const nav = r?.navigationEndpoint;
      const browse = nav?.browseEndpoint?.browseId;
      const watch = nav?.watchEndpoint?.videoId;
      const pageType =
        nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? "";
      console.log(`    run "${r.text}" → browseId=${browse ?? "-"} pageType=${pageType} watch=${watch ?? "-"}`);
    }
    // also dump the flexColumns of the seed panel row (album column shape)
    console.log("  seed flexColumns:");
    for (const [i, c] of (seed.flexColumns ?? []).entries()) {
      console.log(`    col${i}: ${runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text)}`);
      for (const r of c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) {
        const nav = r?.navigationEndpoint;
        const browse = nav?.browseEndpoint?.browseId;
        if (browse) console.log(`      run "${r.text}" → browseId=${browse} pageType=${nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? ""}`);
      }
    }

    // ── step 3: if the album run carried an MPREb_ browseId, browse it ────────
    const albumBrowse = [
      ...(seed.longBylineText?.runs ?? []),
      ...((seed.flexColumns ?? []).flatMap((c: any) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])),
    ]
      .map((r: any) => r?.navigationEndpoint?.browseEndpoint?.browseId)
      .find((b: string) => typeof b === "string" && b.startsWith("MPREb_"));
    if (albumBrowse) {
      console.log(`\nSTEP 3: browse album ${albumBrowse}`);
      const b = await post("browse", { browseId: albumBrowse });
      if (b) {
        const header = collect(b, "musicDetailHeaderRenderer")[0] ?? collect(b, "musicResponsiveHeaderRenderer")[0];
        const title = runsText(header?.title);
        const rows = collect(b, "musicResponsiveListItemRenderer");
        console.log(`  album title: "${title}"  rows: ${rows.length}`);
        for (const r of rows.slice(0, 12)) {
          const rc: string[] = (r.flexColumns ?? []).map((c: any) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
          const vid = r?.playlistItemData?.videoId ?? r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ?? "";
          console.log(`    track [${vid}] ${rc[0]} | ${rc.slice(1).join(" / ")}`);
        }
      }
    } else {
      console.log("\nSTEP 3: no MPREb_ on the seed byline runs — will need the album NAME path");
    }
    break; // with-playlistId result is enough if it worked; videoId-only kept as fallback probe
  }
}

main();
