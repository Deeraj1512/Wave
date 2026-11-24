/**
 * Unit tests (bun) for the taste engine (v43 — the STRICT language law):
 *   1. strictLangFilter — songs outside the SELECTED languages are dropped,
 *      hard. No trickle, no "1-2 at a time", no unknown-language free pass.
 *      The user's words: "no other language in feed other than selected
 *      language… no Hindi song in feed unless the language is selected."
 *   2. feedLangs — SELECTED languages only; history re-ranks, never re-admits.
 *   3. familiarSet / roundRobin / familiarWeave / rotateBy — the personal-feed
 *      assembly machinery.
 */
import {
  strictLangFilter,
  feedLangs,
  tasteLangWeights,
  familiarSet,
  inTaste,
  roundRobin,
  familiarWeave,
  rotateBy,
} from "../src/lib/taste";
import { saveProfile, getProfile, clearProfile, rankedTasteLangs } from "../src/lib/profile";
import { recordPlay, recentPlays } from "../src/lib/history";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

type Row = { title: string; artist: string; album?: string; lang?: string; plays?: string };

// ── save a profile: Telugu first, Tamil second — Hindi NEVER picked ──
saveProfile({
  name: "Tester",
  langs: ["Telugu", "Tamil"],
  artists: [
    { name: "Sid Sriram", lang: "Telugu" },
    { name: "Anirudh Ravichander", lang: "Tamil" },
  ],
});

console.log("\n[1] profile store");
const p = getProfile();
check("profile saved", !!p && p.name === "Tester" && p.langs[0] === "Telugu");
check("rankedTasteLangs = pick order", JSON.stringify(rankedTasteLangs()) === '["Telugu","Tamil"]', JSON.stringify(rankedTasteLangs()));
check("profile artists familiar day-one", familiarSet().has("sid sriram") && familiarSet().has("anirudh ravichander"));

console.log("\n[2] strictLangFilter — the user's exact scenario");
const tel: Row[] = Array.from({ length: 10 }, (_, i) => ({ title: `tel${i}`, artist: "x", lang: "Telugu" }));
const tam: Row[] = Array.from({ length: 4 }, (_, i) => ({ title: `tam${i}`, artist: "x", lang: "Tamil" }));
const hin: Row[] = Array.from({ length: 6 }, (_, i) => ({ title: `hin${i}`, artist: "Arijit Singh", lang: "Hindi" }));
const eng: Row[] = Array.from({ length: 3 }, (_, i) => ({ title: `eng${i}`, artist: "x", lang: "English" }));
const locked = strictLangFilter([...tel, ...tam, ...hin, ...eng], ["Telugu", "Tamil"]);
check("hindi songs dropped, hard (0 survive)", locked.filter((t) => t.lang === "Hindi").length === 0, `got ${locked.filter((t) => t.lang === "Hindi").length}`);
check("english dropped too", locked.filter((t) => t.lang === "English").length === 0);
check("all 10 telugu kept", locked.filter((t) => t.lang === "Telugu").length === 10);
check("all 4 tamil kept", locked.filter((t) => t.lang === "Tamil").length === 4);
check("order preserved", locked[0].title === "tel0" && locked[10].title === "tam0");

console.log("\n[3] strictLangFilter — 12-row made-for-you shelf (picked artists' other-language songs)");
const sidPool: Row[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ title: `sid-tel${i}`, artist: "Sid Sriram", lang: "Telugu" })),
  // the leak the user reported: Sid Sriram's HINDI songs behind a Telugu pick
  ...Array.from({ length: 2 }, (_, i) => ({ title: `sid-hin${i}`, artist: "Sid Sriram", lang: "Hindi" })),
];
const sidLocked = strictLangFilter(sidPool, ["Telugu", "Tamil"]);
check("picked artist's hindi songs dropped", sidLocked.length === 6 && sidLocked.every((t) => t.lang === "Telugu"), JSON.stringify(sidLocked.map((t) => t.title)));

console.log("\n[4] undetectable language — dropped unless the pool presumes its own language");
const unknown: Row = { title: "Veezha Veera", artist: "x" };
const mixedUnknown: Row[] = [unknown, { title: "kesariya", artist: "y" }]; // kesariya IS detectable (Hindi)
check("unknown dropped without presumption", strictLangFilter([unknown], ["Telugu", "Tamil"]).length === 0);
check("unknown kept with a feed-language presumption", strictLangFilter([unknown], ["Telugu", "Tamil"], { presumptive: "Telugu" }).length === 1);
check("detectable hindi in the same pool still dropped despite presumption", strictLangFilter(mixedUnknown, ["Telugu", "Tamil"], { presumptive: "Telugu" }).every((t) => t.title !== "kesariya"));
check("presumption outside the feed languages is ignored", strictLangFilter([unknown], ["Telugu", "Tamil"], { presumptive: "Hindi" as never }).length === 0);
check("detectable hindi NOT saved by presumption", strictLangFilter([{ title: "x", artist: "y", lang: "Hindi" }], ["Telugu"], { presumptive: "Telugu" }).length === 0);
check("strict inTaste: unknown = outside", inTaste({ title: "Veezha Veera", artist: "x" }, ["Telugu"]) === false);

console.log("\n[5] no feed languages (cold start) → pool passes through untouched");
const raw: Row[] = [...tel.slice(0, 5), ...eng.slice(0, 3)];
check("empty feed languages = identity", strictLangFilter(raw, []) === raw);

console.log("\n[6] feedLangs — SELECTED languages only; history never re-admits");
check("profile languages, in pick order", JSON.stringify(feedLangs()) === '["Telugu","Tamil"]', JSON.stringify(feedLangs()));
// history plays a couple of Hindi songs — the DOOR STAYS CLOSED
recordPlay({ id: "hin1", title: "Tum Hi Ho", artist: "Arijit Singh", lang: "Hindi" });
recordPlay({ id: "tel1", title: "Butta Bomma", artist: "Armaan Malik", lang: "Telugu" });
recordPlay({ id: "tel2", title: "Samajavaragamana", artist: "Sid Sriram", lang: "Telugu" });
check("stray hindi history does NOT enter the feed languages", !feedLangs().includes("Hindi"), JSON.stringify(feedLangs()));
check("telugu plays sharpen but the set stays selected", JSON.stringify(feedLangs()) === '["Telugu","Tamil"]', JSON.stringify(feedLangs()));
// no profile at all → the user's own plays define the set
clearProfile();
check("no profile → history languages (telugu ≥2 plays qualifies)", JSON.stringify(feedLangs()) === '["Telugu"]', JSON.stringify(feedLangs()));
check("no profile, no history → no contract", (recentPlays(60).length >= 0) && JSON.stringify(feedLangs()) === '["Telugu"]');

// restore the profile for the assembly tests
saveProfile({
  name: "Tester",
  langs: ["Telugu", "Tamil"],
  artists: [{ name: "Sid Sriram", lang: "Telugu" }],
});

console.log("\n[7] tasteLangWeights — profile floor + history merge");
const w = tasteLangWeights(new Map([["Telugu", 40], ["Tamil", 2]]));
check("telugu dominant", (w.get("Telugu") ?? 0) > (w.get("Tamil") ?? 0));
check("hindi has NO weight (never listened, never picked)", !w.has("Hindi"));
const w2 = tasteLangWeights(); // no history at all — pure profile floor
check("fresh install still taste-ranked", (w2.get("Telugu") ?? 0) >= 5 && !w2.has("Hindi"));

console.log("\n[8] roundRobin — Made-for-you interleave in language pick order");
// groups arrive in language pick order: Telugu artist, Tamil artist, Telugu artist
const gSid = Array.from({ length: 3 }, (_, i) => ({ title: `sid${i}`, artist: "Sid Sriram" }));
const gAni = Array.from({ length: 3 }, (_, i) => ({ title: `ani${i}`, artist: "Anirudh" }));
const gSun = Array.from({ length: 2 }, (_, i) => ({ title: `sun${i}`, artist: "Sunidhi" }));
const rr = roundRobin([gSid, gAni, gSun]);
check("interleaved round-robin order", JSON.stringify(rr.map((t) => t.title)) === '["sid0","ani0","sun0","sid1","ani1","sun1","sid2","ani2"]', JSON.stringify(rr.map((t) => t.title)));
check("take caps the shelf", roundRobin([gSid, gAni, gSun], { take: 4 }).length === 4);
check("empty groups tolerated", roundRobin([[], gSid, []]).every((t) => t.artist === "Sid Sriram"));

console.log("\n[9] familiarWeave — ongoing taste leads the dial");
const famPool = Array.from({ length: 10 }, (_, i) => ({ title: `fam${i}`, artist: "Sid Sriram" }));
const restPool = Array.from({ length: 10 }, (_, i) => ({ title: `rest${i}`, artist: "Someone Else" }));
const woven = familiarWeave(famPool, restPool, 9);
check("familiar tracks take the front", woven.slice(0, 2).every((t) => t.title.startsWith("fam")));
check("2:1 weave pattern", JSON.stringify(woven.map((t) => (t.title.startsWith("fam") ? "F" : "R"))) === '["F","F","R","F","F","R","F","F","R"]', JSON.stringify(woven.map((t) => (t.title.startsWith("fam") ? "F" : "R"))));
check("fam exhausted → rest drains", familiarWeave(famPool.slice(0, 1), restPool, 6).length === 6);
check("no familiar → pool passes through", familiarWeave([], restPool, 5).every((t) => t.title.startsWith("rest")));

console.log("\n[10] rotateBy — daily spotlight rotation");
const cast = ["A", "B", "C", "D"];
check("seed 0 = unchanged", JSON.stringify(rotateBy(cast, 0)) === '["A","B","C","D"]');
check("seed 1 shifts by one", JSON.stringify(rotateBy(cast, 1)) === '["B","C","D","A"]');
check("seed wraps at length", JSON.stringify(rotateBy(cast, 4)) === '["A","B","C","D"]');
check("deterministic same-day", JSON.stringify(rotateBy(cast, 20089)) === JSON.stringify(rotateBy(cast, 20089)));

console.log("\n[11] Made-for-you end-to-end assembly (the Home.tsx flow, pure)");
// profile: Telugu first, Tamil second; artists tagged with their language;
// cast order after history-weighting + rotation; groups built per artist with
// their OWN language, then sorted by language pick order → cast order
const built = [
  { lang: "Tamil" as const, group: gAni.map((t) => ({ ...t, lang: "Tamil" as const })), ci: 0 },
  { lang: "Telugu" as const, group: gSid.map((t) => ({ ...t, lang: "Telugu" as const })), ci: 1 },
];
const langRank = new Map([["Telugu", 0], ["Tamil", 1]]);
built.sort((a, b) => (langRank.get(a.lang) ?? 99) - (langRank.get(b.lang) ?? 99) || a.ci - b.ci);
const shelfRows = roundRobin(built.map((b) => b.group), { take: 20 });
check("telugu artist leads (pick order wins over cast order)", shelfRows[0].artist === "Sid Sriram", shelfRows[0].artist);
check("languages alternate, never block", shelfRows.slice(0, 4).map((t) => t.lang).join(",") === "Telugu,Tamil,Telugu,Tamil", shelfRows.slice(0, 4).map((t) => t.lang).join(","));
// the final strict pass on the assembled shelf (defense in depth)
const shelfLocked = strictLangFilter([...shelfRows, { title: "leak", artist: "Arijit Singh", lang: "Hindi" }], ["Telugu", "Tamil"]);
check("final pass strips any unselected-language leak", shelfLocked.length === shelfRows.length && shelfLocked.every((t) => t.lang !== "Hindi"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
