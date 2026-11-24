/**
 * Unit tests (bun) for the STRICT language detector (src/lib/langs.ts):
 *   - guessLangFromWords: romanized title words classify Hindi vs Telugu vs
 *     Tamil vs Punjabi… ("Kesariya" → Hindi, "Butta Bomma" → Telugu,
 *     "Vaathi Coming" → Tamil); ties and cross-language words prove nothing.
 *   - trackLangOf ladder: explicit field → marker → native script → movie
 *     fact → words → decisive artist profile (empty catalog in tests, so the
 *     artist legs stay inert and the earlier legs are what's verified).
 *   - strictLangFilter drop policy against a Telugu + Tamil profile: a Hindi
 *     song by a Telugu-dominant multilingual artist (the exact user-reported
 *     leak) never passes.
 */
import { guessLangFromWords, trackLangOf, detectTrackLang } from "../src/lib/langs";
import { strictLangFilter, feedLangs } from "../src/lib/taste";
import { saveProfile } from "../src/lib/profile";

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

// ── profile: Telugu first, Tamil second — the user's own scenario ──
saveProfile({
  name: "Tester",
  langs: ["Telugu", "Tamil"],
  artists: [{ name: "Sid Sriram", lang: "Telugu" }],
});

console.log("\n[1] guessLangFromWords — romanized titles");
check("Kesariya → Hindi", guessLangFromWords("Kesariya") === "Hindi", `${guessLangFromWords("Kesariya")}`);
check("Tum Hi Ho → Hindi", guessLangFromWords("Tum Hi Ho") === "Hindi", `${guessLangFromWords("Tum Hi Ho")}`);
check("Apna Bana Le → Hindi", guessLangFromWords("Apna Bana Le") === "Hindi", `${guessLangFromWords("Apna Bana Le")}`);
check("'aashiqui' word → Hindi", guessLangFromWords("Aashiqui Mashup") === "Hindi", `${guessLangFromWords("Aashiqui Mashup")}`);
check("Butta Bomma → Telugu", guessLangFromWords("Butta Bomma") === "Telugu", `${guessLangFromWords("Butta Bomma")}`);
check("Oo Antava → Telugu", guessLangFromWords("Oo Antava Oo Oo Antava") === "Telugu", `${guessLangFromWords("Oo Antava Oo Oo Antava")}`);
check("Nee Kannu Neeli Samudram → Telugu (samudram)", guessLangFromWords("Nee Kannu Neeli Samudram") === "Telugu", `${guessLangFromWords("Nee Kannu Neeli Samudram")}`);
check("Vaathi Coming → Tamil", guessLangFromWords("Vaathi Coming") === "Tamil", `${guessLangFromWords("Vaathi Coming")}`);
check("Kannamma → Tamil", guessLangFromWords("Kannamma") === "Tamil", `${guessLangFromWords("Kannamma")}`);
check("Raataan Lambiyan → Punjabi", guessLangFromWords("Raataan Lambiyan") === "Punjabi", `${guessLangFromWords("Raataan Lambiyan")}`);
check("Mon Majhi → Bengali", guessLangFromWords("Mon Majhi Re") === "Bengali", `${guessLangFromWords("Mon Majhi Re")}`);
check("cross-language tie proves nothing", guessLangFromWords("Dil Bomma") === undefined, `${guessLangFromWords("Dil Bomma")}`);
check("no Indian words → undefined (English stays undetectable by words)", guessLangFromWords("Shape of You") === undefined);
check("ambiguous shared words never decide", guessLangFromWords("Nee Prema") === undefined, `${guessLangFromWords("Nee Prema")}`);

console.log("\n[2] trackLangOf ladder — order of trust");
check("explicit field wins over everything", trackLangOf({ title: "Kesariya", lang: "Telugu" }) === "Telugu");
check("marker wins over words", trackLangOf({ title: "Butta Bomma (Hindi Version)" }) === "Hindi", `${trackLangOf({ title: "Butta Bomma (Hindi Version)" })}`);
check("native Telugu script wins", trackLangOf({ title: "నీ కన్ను నీలి సముద్రం" }) === "Telugu");
check("native Devanagari script → Hindi", trackLangOf({ title: "तुम ही हो" }) === "Hindi");
check("romanized title words", trackLangOf({ title: "Butta Bomma", album: "", artist: "Armaan Malik" }) === "Telugu");
check("no evidence at all → undefined", trackLangOf({ title: "Shape of You", artist: "Ed Sheeran" }) === undefined);

console.log("\n[3] strictLangFilter — the reported leak, end to end");
const leakPool = [
  { title: "Butta Bomma", artist: "Armaan Malik", album: "Ala Vaikunthapurramuloo", lang: "Telugu" as const },
  // the leak shape: a Hindi song by a Telugu-favorite artist
  { title: "Tum Hi Ho", artist: "Arijit Singh", album: "Aashiqui 2", lang: "Hindi" as const },
  { title: "Kesariya", artist: "Arijit Singh", album: "Brahmastra", lang: "Hindi" as const },
  { title: "Vaathi Coming", artist: "Anirudh Ravichander", album: "Master", lang: "Tamil" as const },
  { title: "Some Unknown Song", artist: "New Singer" },
];
const kept = strictLangFilter(leakPool, feedLangs());
check("hindi rows dropped even with presumption of telugu", !kept.some((t) => t.lang === "Hindi"), JSON.stringify(kept.map((t) => t.title)));
check("telugu + tamil rows kept", kept.some((t) => t.title === "Butta Bomma") && kept.some((t) => t.title === "Vaathi Coming"));
check("undetectable row dropped (no presumption passed)", !kept.some((t) => t.title === "Some Unknown Song"));

console.log("\n[4] detectTrackLang (queue ladder input) unchanged semantics");
check("marker still wins there", detectTrackLang({ title: "Massa Massa (Telugu)" }) === "Telugu");
check("romanized-only still undefined there", detectTrackLang({ title: "Butta Bomma" }) === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
