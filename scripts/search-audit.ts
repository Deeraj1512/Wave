/**
 * Search quality audit — compares our /api/search against "is this as good as YTM/Spotify?"
 * Dimensions: top-result accuracy, multilingual (Telugu/Tamil/Hindi), artist queries,
 * partial queries, junk filtering, result diversity.
 */
const BASE = "http://localhost:3000";

interface ApiTrack {
  videoId: string; title: string; artist: string; album: string;
  durationSec: number; views: number; tier: number; thumb?: string;
}

const QUERIES: Array<{ q: string; expect: string; note: string }> = [
  { q: "inkem inkem inkem kaavaale", expect: "Inkem Inkem — Sid Sriram", note: "Telugu exact, lowercase" },
  { q: "Doli Doli", expect: "Doli Doli — Sankranthi (Shankar Mahadevan/S.A.Rajkumar)", note: "user's screenshot song" },
  { q: "Sid Sriram", expect: "top = his most popular original", note: "artist query" },
  { q: "kesariya", expect: "Kesariya — Arijit Singh (Brahmastra)", note: "Hindi exact" },
  { q: "rowdy baby", expect: "Rowdy Baby — Dhanush/Dhee", note: "Tamil exact" },
  { q: "tum hi ho", expect: "Tum Hi Ho — Arijit Singh", note: "Hindi classic" },
  { q: "samajavaragamana", expect: "Sid Sriram original", note: "Telugu single word" },
  { q: "Butta Bomma", expect: "Butta Bomma — Armaan Malik", note: "Telugu hit" },
  { q: "apadi podu", expect: "Apadi Podu original or sensible fallback", note: "Tamil spelling variant" },
  { q: "sankranthi doli doli", expect: "Doli Doli (Sankranthi)", note: "movie + song" },
  { q: "arjit singh tum hi ho", expect: "Tum Hi Ho — Arijit (typo artist)", note: "typo tolerance" },
  { q: "zzzxqvmalanagaram", expect: "empty/low results, no junk", note: "garbage query" },
];

async function audit() {
  for (const { q, expect, note } of QUERIES) {
    try {
      const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(30000) });
      const data = await res.json();
      const tracks: ApiTrack[] = data.tracks ?? [];
      console.log(`\n=== "${q}"  (${note})`);
      console.log(`    expect: ${expect} | attempts: [${(data.attempts ?? []).join(",")}] dropped: ${JSON.stringify(data.dropped ?? {})}`);
      if (tracks.length === 0) {
        console.log("    → 0 results");
        continue;
      }
      tracks.slice(0, 5).forEach((t, i) => {
        const dur = `${Math.floor(t.durationSec / 60)}:${String(t.durationSec % 60).padStart(2, "0")}`;
        console.log(`    ${i + 1}. [t${t.tier}] "${t.title}" — ${t.artist} | ${t.album} | ${dur} | ${t.views >= 1e6 ? Math.round(t.views / 1e6) + "M" : Math.round(t.views / 1e3) + "K"} plays`);
      });
      console.log(`    total: ${tracks.length}`);
    } catch (e) {
      console.log(`\n=== "${q}" → ERROR ${e instanceof Error ? e.message : e}`);
    }
  }
}

audit();
