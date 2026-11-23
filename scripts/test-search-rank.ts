/** Sanity test for relevanceScore/relevanceRank — simulates the reported "nizam babulu" bug. */
import { relevanceScore, relevanceRank } from "../src/lib/yt/filters";

const songs = [
  { title: "Netho Cheppana", artist: "S.P.Balasubramanyam, Chitra", album: "Athadu", views: 48_000_000, tier: 1 },
  { title: "Vayasa Chusuko", artist: "S.P.Balasubramanyam, Chitra", album: "Premante Idera", views: 31_000_000, tier: 1 },
  { title: "Emaindhi Eevela", artist: "Udit Narayan", album: "Rhythm", views: 22_000_000, tier: 1 },
  { title: "Ayyayo Chetilo Dabbulu", artist: "Mano", album: "Mutyala Muggu", views: 18_000_000, tier: 1 },
  { title: "Kanya Kumaari", artist: "Ilaiyaraaja", album: "Bobbili Raja", views: 15_000_000, tier: 1 },
  { title: "Manase Eduru Tirige", artist: "K.J. Yesudas", album: "Chinna Thambi", views: 12_000_000, tier: 1 },
  { title: "Kandi Chenu Kada", artist: "Mano", album: "Naa Alludu", views: 9_000_000, tier: 1 },
  { title: "Nizam Babulu", artist: "Mano, Swarnalatha", album: "Premante Idera", views: 2_400_000, tier: 1 },
];

const ranked = relevanceRank(songs as any, "nizam babulu");
console.log("Query: nizam babulu");
ranked.forEach((t, i) => console.log(`${i + 1}. ${t.title} (score=${relevanceScore(t, "nizam babulu").toFixed(0)})`));

const ok = ranked[0].title === "Nizam Babulu";
console.log(ok ? "\nPASS: exact match is #1" : "\nFAIL: exact match is NOT #1");

// Secondary cases
console.log("\nQuery: kesariya");
const q2 = relevanceRank(
  [
    { title: "Kesariya", artist: "Arijit Singh", album: "Brahmastra", views: 500_000_000, tier: 1 },
    { title: "Kesariya Balam", artist: " folk", album: "Rajasthani folk", views: 8_000_000, tier: 1 },
    { title: "Tum Kya Mile", artist: "Arijit Singh", album: "Rocky Aur Rani", views: 200_000_000, tier: 1 },
  ] as any,
  "kesariya"
);
q2.forEach((t, i) => console.log(`${i + 1}. ${t.title}`));

// Generic query — no title matches anywhere → order falls back to tier/views (YT-ish)
console.log("\nQuery: telugu hit songs (generic)");
const q3 = relevanceRank(songs as any, "telugu hit songs");
q3.slice(0, 3).forEach((t, i) => console.log(`${i + 1}. ${t.title} (views=${t.views})`));

// Artist-led query
console.log("\nQuery: mano swarnalatha (artist-led)");
const q4 = relevanceRank(songs as any, "mano swarnalatha");
q4.slice(0, 2).forEach((t, i) => console.log(`${i + 1}. ${t.title} (score=${relevanceScore(t, "mano swarnalatha").toFixed(0)})`));
