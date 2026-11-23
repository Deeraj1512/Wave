/** Focused re-audit after fixes. */
const BASE = "http://localhost:3000";
interface ApiTrack { videoId: string; title: string; artist: string; album: string; durationSec: number; views: number; tier: number; }
async function main() {
  const QUERIES = ["Sid Sriram", "sankranthi doli doli", "Butta Bomma", "rowdy baby", "apadi podu", "zzzxqvmalanagaram", "nizam babulu"];
  for (const q of QUERIES) {
  try {
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(45000) });
    const data = await res.json();
    const tracks: ApiTrack[] = data.tracks ?? [];
    console.log(`\n=== "${q}" | attempts: [${(data.attempts ?? []).join(",")}] dropped: ${JSON.stringify(data.dropped ?? {})}`);
    tracks.slice(0, 5).forEach((t, i) => {
      const dur = `${Math.floor(t.durationSec / 60)}:${String(t.durationSec % 60).padStart(2, "0")}`;
      console.log(`  ${i + 1}. [t${t.tier}] "${t.title}" — ${t.artist} | ${t.album} | ${dur} | ${t.views >= 1e6 ? Math.round(t.views / 1e6) + "M" : Math.round(t.views / 1e3) + "K"}`);
    });
    console.log(`  total: ${tracks.length}`);
  } catch (e) { console.log(`\n=== "${q}" ERROR ${e}`); }
}
}
main().catch((e) => { console.error(e); process.exit(1); });