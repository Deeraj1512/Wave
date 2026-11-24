/**
 * Language barrier + vibe tests for queueBlock.ts (the radio-block builder).
 * Run: bun scripts/test_lang_barrier.ts
 */
import {
  relateBlock,
  capArtists,
  baseTitle,
} from "../src/lib/queueBlock";

import type { Lang, Track } from "../src/lib/types";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${extra}`);
  }
};

const mk = (id: string, title: string, artist: string, album = "", lang?: Lang): Track => ({
  id,
  title,
  artist,
  album,
  duration: 200,
  lang,
  year: 0,
  plays: "",
  colors: ["#000", "#111"],
});

// --- language detector stand-in: titles carry explicit markers, album "Hindi OST" style
// Mirrors the real chain (detectTrackLang ?? inferLiveLang): markers/keywords/scripts
// detect; unknown albums + unknown artists return UNDEFINED (undetectable stays).
const langOfFor = (seedLang: Lang | undefined) => (t: Track): Lang | undefined => {
  const m = /\((hindi|tamil|telugu|punjabi|kannada|malayalam|bengali|english)\)/i.exec(t.title);
  if (m) return m[1].toLowerCase() as Lang;
  if (t.lang) return t.lang;
  if (/\bhindi\b/i.test(t.album)) return "Hindi";
  if (/\btelugu\b/i.test(t.album)) return "Telugu";
  if (/\btamil\b/i.test(t.album)) return "Tamil";
  return undefined; // undetectable — exactly what inferLiveLang returns with no catalog match
};

// NOTE: relateBlock keeps undetectable tracks (the Mix is seeded by the song,
// so undetectable rows are overwhelmingly in-language). Tests model that.

// ── 1. HARD BARRIER: another-language tracks are dropped, never filler ──
{
  const seed = mk("s1", "Butta Bomma", "Armaan Malik", "Ala Vaikunthapurramuloo", "Telugu");
  const pool = [
    mk("h1", "Tum Hi Ho", "Arijit Singh", "Hindi OST"), // Hindi (album-detected)
    mk("h2", "Kesariya", "Arijit Singh", "Brahmastra"), // undetectable — stays (neutral)
    mk("t1", "Nuvvunna Chalu", "Sid Sriram", "Telugu OST"), // Telugu
    mk("t2", "Inkem Inkem", "Sid Sriram", "Telugu OST"), // Telugu
    mk("h3", "Raabta", "Arijit Singh", "Hindi OST"), // Hindi
  ];
  const out = relateBlock(seed, pool, langOfFor("Telugu"));
  const langs = out.map((t) => t.id);
  check("barrier: hindi tracks dropped entirely", !langs.includes("h1") && !langs.includes("h3"));
  check("barrier: telugu tracks kept", langs.includes("t1") && langs.includes("t2"));
  check("barrier: undetectable stays (neutral)", langs.includes("h2"));
}

// ── 2. SAME SONG, OTHER LANGUAGE = drift, dropped ──
{
  const seed = mk("s1", "Massa Massa", "Someone", "Telugu OST", "Telugu");
  const pool = [
    mk("m1", "Massa Massa (Hindi)", "Someone", "Hindi OST"), // variant in another language
    mk("t1", "Other Telugu Song", "Someone", "Telugu OST"),
  ];
  const out = relateBlock(seed, pool, langOfFor("Telugu"));
  check("variant dropped", !out.some((t) => t.id === "m1"), JSON.stringify(out.map((x) => x.id)));
  check("in-language kept", out.some((t) => t.id === "t1"));
}

// ── 3. VIBE: seed movie/album mates lead, then seed artist ──
{
  const seed = mk("s1", "Butta Bomma", "Armaan Malik", "Ala Vaikunthapurramuloo", "Telugu");
  const pool = [
    mk("t1", "Samajavaragamana", "Sid Sriram", "Ala Vaikunthapurramuloo"), // same movie
    mk("t2", "OMG Daddy", "Thaman S", "Ala Vaikunthapurramuloo"), // same movie
    mk("t3", "Careful", "Sid Sriram", "Telugu OST"), // seed artist, other movie
    mk("t4", "Random Song", "Random Guy", "Telugu OST"),
  ];
  const out = relateBlock(seed, pool, langOfFor("Telugu"));
  check("vibe: same-movie mates lead the block", out[0]?.id === "t1" || out[0]?.id === "t2", JSON.stringify(out.map((x) => x.id)));
  check("vibe: seed artist follows mates", out[out.length - 1]?.id === "t4");
}

// ── 4. LANGUAGE CHIP: user-chosen language overrides the seed's language ──
{
  const seed = mk("s1", "Butta Bomma", "Armaan Malik", "Ala Vaikunthapurramuloo", "Telugu");
  const pool = [
    mk("h1", "Tum Hi Ho", "Arijit Singh", "Hindi OST"), // Hindi
    mk("h2", "Kesariya", "Arijit Singh", "Hindi OST"), // Hindi
    mk("t1", "Nuvvunna Chalu", "Sid Sriram", "Telugu OST"), // Telugu
  ];
  const out = relateBlock(seed, pool, langOfFor("Telugu"), "Hindi");
  const ids = out.map((t) => t.id);
  check("chip: hindi block when the user taps Hindi", ids.includes("h1") && ids.includes("h2") && !ids.includes("t1"));
}

// ── 5. UNDETECTABLE language tracks stay (never stranded into an empty queue) ──
{
  const seed = mk("s1", "Butta Bomma", "Armaan Malik", "", "Telugu");
  const noDetect = (): Lang | undefined => undefined; // detection totally blind
  const pool = [mk("u1", "Romanized Unknown", "Someone"), mk("u2", "Another Unknown", "Other Guy")];
  const out = relateBlock(seed, pool, noDetect);
  check("unknown-language kept when nothing is detectable", out.length === 2, JSON.stringify(out.map((x) => x.id)));
}

// ── 6. baseTitle collapses cross-language variants of one song ──
check("baseTitle: variant collapse", baseTitle("Massa Massa (Hindi)") === baseTitle("Massa Massa (Telugu)"));

// ── 7. capArtists: max 2 per artist, seed artist 3 ──
{
  const pool = [
    mk("a1", "One", "Sid Sriram"),
    mk("a2", "Two", "Sid Sriram"),
    mk("a3", "Three", "Sid Sriram"),
    mk("a4", "Four", "Sid Sriram"),
    mk("b1", "Five", "Sachet Tandon"),
    mk("b2", "Six", "Sachet Tandon"),
    mk("b3", "Seven", "Sachet Tandon"),
  ];
  const out = capArtists(pool, "Sid Sriram");
  const sid = out.filter((t) => t.artist === "Sid Sriram").length;
  const sachet = out.filter((t) => t.artist === "Sachet Tandon").length;
  check("cap: seed artist keeps 3", sid === 3, `got ${sid}`);
  check("cap: regular artist capped at 2", sachet === 2, `got ${sachet}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
