/* Direct trace of resolveStreamSmart outside Next/Turbopack */
import { resolveStreamSmart, getChainDebug } from "../src/lib/yt/resolve";
import { searchForSiblings } from "../src/lib/yt/search";

async function main() {
  console.log("── sibling search: 'kesariya arijit' (videos filter)");
  const s = await searchForSiblings("kesariya arijit");
  console.log("attempts:", s.attempts, "tracks:", s.tracks.length, "dropped:", s.dropped);
  s.tracks.slice(0, 6).forEach((t) => console.log(`  [t${t.tier}] ${t.title} — ${t.artist} · ${t.durationSec}s · ${t.videoId}`));

  console.log("── resolveStreamSmart NJAv_7lHUIU");
  const r = await resolveStreamSmart("NJAv_7lHUIU", { title: "Kesariya", artist: "Arijit Singh" });
  console.log(r ? `RESOLVED via ${r.client} (sibling=${r.viaSibling}, itag=${r.itag}, len=${r.contentLength})` : "NULL");
  console.log("chain:", JSON.stringify(getChainDebug(), null, 1));
}
main();
