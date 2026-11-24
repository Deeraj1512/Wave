/**
 * Measure: how many per-artist tracks survive the STRICT ladder with NO
 * presumption — tells us whether Made-for-you can afford full strictness.
 */
import { saveProfile } from "../src/lib/profile";
import { apiTrackToTrack } from "../src/lib/api";
import { strictLangFilter } from "../src/lib/taste";
import type { ApiTrack } from "../src/lib/api";
import type { Lang } from "../src/lib/types";

const BASE = process.env.BASE ?? "http://localhost:3000";
const FEED_LANGS: Lang[] = ["Telugu", "Tamil"];
saveProfile({ name: "Dheeraj", langs: FEED_LANGS, artists: [] });

async function search(q: string) {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`);
  const data = (await res.json()) as { tracks: ApiTrack[] };
  return data.tracks.map(apiTrackToTrack);
}

const cast = [
  { name: "Kaala Bhairava", lang: "Telugu" as Lang },
  { name: "Anurag Kulkarni", lang: "Telugu" as Lang },
  { name: "Sid Sriram", lang: "Telugu" as Lang },
  { name: "Anirudh Ravichander", lang: "Tamil" as Lang },
  { name: "Sunidhi Chauhan", lang: "Telugu" as Lang },
  { name: "Ram Miriyala", lang: "Telugu" as Lang },
];
for (const c of cast) {
  const raw = await search(`${c.name} ${c.lang} songs`);
  const noP = strictLangFilter(raw, FEED_LANGS);
  const withP = strictLangFilter(raw, FEED_LANGS, { presumptive: c.lang });
  const noPfor = noP.filter((t) => t.lang && t.lang !== "Telugu" && t.lang !== "Tamil");
  console.log(
    `${c.name.padEnd(22)} raw:${String(raw.length).padStart(3)}  no-presumption:${String(noP.length).padStart(3)}  presumed:${withP.length - noP.length}  foreign-in-noP:${noPfor.length}`
  );
}
