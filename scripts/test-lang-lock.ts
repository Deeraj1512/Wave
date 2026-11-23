/** Language-lock sanity: romanized live tracks must infer via catalog movie/artist profiles. */
import { detectTrackLang, inferLiveLang } from "../src/lib/langs";

const cases: Array<{ title: string; artist: string; album?: string; expect: string; note: string }> = [
  // movie-name inference (album from live results matches a catalog movie)
  { title: "Vayasa Chusuko", artist: "S.P.Balasubramanyam, Chitra", album: "Premante Idera", expect: "Telugu", note: "movie lookup" },
  { title: "Nizam Babulu", artist: "Mano, Swarnalatha", album: "Premante Idera", expect: "Telugu", note: "movie lookup" },
  // artist-profile inference (no album match)
  { title: "Some Unknown Romantic Hit", artist: "Sid Sriram", expect: "seed-or-profile", note: "artist profile" },
  // foreign-only artist — drift marker
  { title: "Random Romanized Song", artist: "Arijit Singh", expect: "Hindi", note: "foreign-only artist" },
  // explicit marker still wins
  { title: "Massa Massa (Hindi)", artist: "Someone", expect: "Hindi", note: "marker" },
];

// what does the catalog know?
console.log("— detect on pure text (all undefined for romanized) —");
for (const c of cases) {
  console.log(`${c.title}: detect=${detectTrackLang({ title: c.title, album: c.album }) ?? "∅"}`);
}

console.log("\n— inferLiveLang (seedLang=Telugu) —");
for (const c of cases) {
  const got = inferLiveLang({ title: c.title, album: c.album, artist: c.artist }, "Telugu") ?? "∅";
  console.log(`${c.title} [${c.artist}${c.album ? " · " + c.album : ""}] → ${got} (${c.note})`);
}

console.log("\n— seed inference (no seedLang) —");
for (const t of [
  { title: "Inkem Inkem Inkem Kaavaale", artist: "Sid Sriram", album: "Geetha Govindam" },
  { title: "Nuvvunna Chalu", artist: "Sid Sriram", album: "Ninnu Kori" },
  { title: "Kesariya", artist: "Arijit Singh", album: "Brahmastra" },
]) {
  console.log(`${t.title} → ${inferLiveLang(t) ?? "∅"}`);
}
