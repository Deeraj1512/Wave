/**
 * Live re-verification of the go-to-album chain (same code that ships in v36).
 * 1. albumOfVideo("QgqwqmcuZgk")  → YouTube's own linkage for "Chitti"
 * 2. resolveAlbumForVideo(...)    → the exact album page ("Jathi Ratnalu")
 * 3. searchAlbums("Jathi Ratnalu") + browseAlbum → the page the app opens by name
 */
import { albumOfVideo, resolveAlbumForVideo, searchAlbums, browseAlbum } from "../src/lib/yt/album";

const CHITTI = "QgqwqmcuZgk"; // Chitti — Jathi Ratnalu (verified videoId)

console.log("── 1. albumOfVideo (linkage) ──");
const link = await albumOfVideo(CHITTI);
console.log(JSON.stringify(link, null, 2));

console.log("\n── 2. resolveAlbumForVideo (exact page) ──");
const page = await resolveAlbumForVideo(CHITTI);
if (page) {
  console.log(`title:    ${page.title}`);
  console.log(`artist:   ${page.artist}`);
  console.log(`year:     ${page.year ?? "?"}`);
  console.log(`browseId: ${page.browseId}`);
  console.log(`tracks:   ${page.tracks.length}`);
  for (const t of page.tracks) console.log(`   • ${t.title}  —  ${t.artist}  [${t.videoId}]`);
} else {
  console.log("NULL — linkage failed");
}

console.log("\n── 3. name search fallback ('Jathi Ratnalu') ──");
const ents = await searchAlbums("Jathi Ratnalu");
console.log(`entities: ${ents.length}`);
for (const e of ents.slice(0, 4)) console.log(`   ${e.title} | ${e.artist} | ${e.browseId}`);
if (ents.length > 0) {
  const det = await browseAlbum(ents[0].browseId);
  console.log(`browse → ${det?.title} (${det?.tracks.length} tracks)`);
}
