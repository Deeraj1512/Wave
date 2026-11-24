/**
 * Probe: do googlevideo /videoplayback URLs return Access-Control-Allow-Origin?
 * This decides whether a Web Audio (MediaElementSource → GainNode) volume boost
 * is possible in the APK, where the <audio> element plays a cross-origin
 * googlevideo URL directly. Without ACAO the WebAudio graph would output silence.
 */
import { resolveStreamSmart } from "../src/lib/yt/resolve";

async function main() {
  // a stable, widely available official video (Kesariya — verified in earlier probes)
  const vid = process.argv[2] ?? "BddP6PYo2gs";
  console.log("resolving", vid, "…");
  const r = await resolveStreamSmart(vid, { title: "Kesariya", artist: "Arijit Singh" });
  if (!r) {
    console.log("RESOLVE FAILED — cannot probe CORS");
    return;
  }
  console.log("resolved via", r.client, r.mimeType, (r.bitrate ?? 0) / 1000 + "kbps");
  for (const origin of ["https://localhost", "null"]) {
    const res = await fetch(r.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Origin: origin, Range: "bytes=0-1023" },
    });
    const h = res.headers;
    console.log(`Origin=${origin} → status`, res.status);
    console.log("  access-control-allow-origin:", h.get("access-control-allow-origin"));
    console.log("  access-control-allow-headers:", h.get("access-control-allow-headers"));
    console.log("  timing-allow-origin:", h.get("timing-allow-origin"));
    await res.body?.cancel().catch(() => {});
  }
}

main().catch((e) => {
  console.error("probe error:", e?.message ?? e);
});
