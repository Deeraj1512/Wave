/** Debug: does YTM's songs filter actually return "Butta Bomma"? Dump raw parsed titles. */
import { searchOriginals, searchForSiblings } from "../src/lib/yt/search";
import { relevanceScore } from "../src/lib/yt/filters";

async function main() {
  const q = process.argv[2] ?? "Butta Bomma";
  for (const fn of [searchOriginals, searchForSiblings]) {
    const r = await fn(q);
    console.log(`\n### ${fn.name} for "${q}" → ${r.tracks.length} tracks, dropped=${JSON.stringify(r.dropped)}`);
    r.tracks.slice(0, 12).forEach((t, i) => {
      const s = relevanceScore(t, q).toFixed(0);
      console.log(`  ${i + 1}. [t${t.tier} s${s}] "${t.title}" — ${t.artist} | ${t.album} | ${t.views >= 1e6 ? Math.round(t.views / 1e6) + "M" : Math.round(t.views / 1e3) + "K"}`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
