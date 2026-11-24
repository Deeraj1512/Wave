/**
 * STRICT artist-photo verification — resolves a set of names through the fixed
 * ladder (YTM artists filter → Deezer → unfiltered strict → Deezer loose) and
 * builds ONE contact sheet so a human eye can confirm every circle is a real
 * artist face (not a poster, not a junk channel avatar).
 */
import { artistPhoto } from "../src/lib/yt/artistPhoto";
import { writeFileSync } from "fs";

const names = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [
      // the Radio-shelf artists from the user's screenshot
      "Arijit Singh", "Shreya Ghoshal", "A.R. Rahman", "Sid Sriram", "Anirudh Ravichander",
      // the names that used to resolve junk channels / posters
      "Ram Miriyala", "Kaala Bhairava", "Revanth", "Geetha Madhuri", "Harika Narayan",
      "Yazin Nizar", "S. P. Balasubrahmanyam",
    ];

async function main() {
  const found: Array<{ name: string; url: string }> = [];
  for (const n of names) {
    const url = await artistPhoto(n).catch(() => undefined);
    const src = url?.includes("deezer") ? "deezer" : url ? "ytm" : "MISS";
    console.log(`${url ? "OK  " : "MISS"} ${n.padEnd(22)} ${src.padEnd(6)} ${url ?? ""}`);
    if (url) found.push({ name: n, url });
  }
  console.log(`\n${found.length}/${names.length} resolved`);

  // contact sheet: download each avatar, tile them with names
  if (found.length > 0) {
    const tiles: Array<{ buf: Buffer; name: string }> = [];
    for (const f of found) {
      try {
        const r = await fetch(f.url);
        if (!r.ok) continue;
        tiles.push({ buf: Buffer.from(await r.arrayBuffer()), name: f.name });
      } catch {
        /* skip broken tile */
      }
    }
    // let PIL assemble with labels (no font hassles in bun)
    for (let i = 0; i < tiles.length; i++) {
      writeFileSync(`/tmp/artist/tile_${i}.jpg`, tiles[i].buf);
      writeFileSync(`/tmp/artist/tile_${i}.name`, tiles[i].name);
    }
    console.log(`tiles: ${tiles.length} → /tmp/artist/tile_*.jpg`);
  }
}

main();
