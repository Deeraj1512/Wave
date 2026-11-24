/**
 * Probe: which audio itags/bitrates does each client in STREAM_CHAIN return
 * for a known music video? (Decides the sound-quality lanes we can offer.)
 */
import { STREAM_CHAIN } from "../src/lib/yt/clients";

const VID = process.argv[2] ?? "BddP6PYo2gs"; // Kesariya (Arijit Singh) official audio
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

async function playerFor(c: (typeof STREAM_CHAIN)[0]) {
  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: c.name,
        clientVersion: c.version,
        hl: "en",
        gl: "IN",
        ...(c.osName ? { osName: c.osName, osVersion: c.osVersion ?? "1.0" } : {}),
        ...(c.androidSdkVersion ? { androidSdkVersion: c.androidSdkVersion } : {}),
      },
    },
    videoId: VID,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": c.userAgent,
    "X-Goog-Api-Key": KEY,
    "X-YouTube-Client-Name": c.id,
    "X-YouTube-Client-Version": c.version,
    "X-Goog-Visitor-Id": "none",
    Origin: "https://music.youtube.com",
  };
  const res = await fetch("https://music.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json()) as any;
}

for (const c of STREAM_CHAIN) {
  try {
    const pr = await playerFor(c);
    const st = pr?.playabilityStatus?.status;
    const fmts: any[] = pr?.adaptiveFormats ?? pr?.streamingData?.adaptiveFormats ?? [];
    const audio = fmts.filter((f) => (f.mimeType ?? "").startsWith("audio/"));
    const rows = audio
      .map((f) => ({ itag: f.itag, mime: (f.mimeType ?? "").split(";")[0], kbps: Math.round((f.bitrate ?? 0) / 1000), url: typeof f.url === "string" && f.url.startsWith("http") }))
      .sort((a, b) => b.kbps - a.kbps);
    console.log(`\n== ${c.name} (${c.version}) status=${st} audioFormats=${audio.length}`);
    for (const r of rows) console.log(`   itag ${r.itag}  ${r.mime}  ${r.kbps}kbps  plainUrl=${r.url}`);
  } catch (e: any) {
    console.log(`\n== ${c.name} ERROR ${e?.message}`);
  }
}
