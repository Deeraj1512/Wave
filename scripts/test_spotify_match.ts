/**
 * Offline threshold test for the Spotify → YouTube matcher scoring.
 * Run: bun scripts/test_spotify_match.ts
 * No network — scoreHit is pure; ytSearch/matchSpotifyTrack are NOT touched.
 */
import { scoreHit } from "../src/lib/spotify/match";
import type { SpMatchInput } from "../src/lib/spotify/match";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, got: unknown, want: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}  (score=${got})`);
  } else {
    fail++;
    console.log(`FAIL  ${name}  got=${got} want=${want}`);
  }
}

const buttera: SpMatchInput = {
  id: "sp-1",
  name: "Butta Bomma (From \"Ala Vaikunthapurramuloo\")",
  durationMs: 218000,
  artists: ["Sunidhi Chauhan", "Armaan Malik"],
};

// 1. The real-world shape: YTM video-tier upload with promo noise, exact duration.
const videoNoise = {
  videoId: "vv1",
  title: "Butta Bomma Video Song 8K | Ala Vaikunthapurramuloo | Allu Arjun | Sunidhi Chauhan",
  artist: "Sunidhi Chauhan",
  album: "Ala Vaikunthapurramuloo",
  durationSec: 218,
  views: 800000000,
  tier: 2,
  rel: 8000,
};
const s1 = scoreHit(buttera, videoNoise);
check("promo-noise video upload accepts", s1 !== null && s1 >= 48, s1, ">= 48");

// 2. ATV / official-audio candidate, spotless title.
const atv = {
  videoId: "vv2",
  title: "Butta Bomma",
  artist: "Sunidhi Chauhan - Topic",
  album: "Ala Vaikunthapurramuloo",
  durationSec: 219,
  views: 900000000,
  tier: 1,
  rel: 9500,
};
const s2 = scoreHit(buttera, atv);
check("clean ATV official audio accepts stronger", s2 !== null && s2 > (s1 ?? -1), s2, "> case1");

// 3. A different song entirely — same artist, wrong title.
const s3 = scoreHit(buttera, { ...atv, videoId: "vv3", title: "Saami Saami", durationSec: 210 });
check("different song rejects", s3 === null, s3, "null");

// 4. Right title, 100 seconds off (a dj mix / extended loop).
const s4 = scoreHit(buttera, { ...atv, videoId: "vv4", durationSec: 318 });
check("duration 100s off rejects", s4 === null, s4, "null");

// 5. Duration 12s off (movie intro) but title + artist exact — accepted, mid score.
const s5 = scoreHit(buttera, { ...atv, videoId: "vv5", durationSec: 230, rel: 4000 });
check("movie-intro duration accepts", s5 !== null && s5 >= 48, s5, ">= 48");

// 6. Telugu native-script title match.
const telugu: SpMatchInput = { id: "sp-6", name: "Nee Kannu Neeli Samudram", durationMs: 251000, artists: ["Revanth"] };
const s6 = scoreHit(telugu, {
  videoId: "vv6",
  title: "Nee Kannu Neeli Samudram Lyrical | Uppena",
  artist: "Revanth - Topic",
  album: "Uppena",
  durationSec: 250,
  views: 120000000,
  tier: 2,
  rel: 7000,
});
check("telugu lyrical-video upload accepts", s6 !== null && s6 >= 48, s6, ">= 48");

// 7. Nightcore-style speedup — title matches, duration collapsed.
const s7 = scoreHit(buttera, { ...atv, videoId: "vv7", title: "Butta Bomma (Sped Up)", durationSec: 185 });
check("sped-up version rejects on duration", s7 === null, s7, "null");

// 8. Borderline: title 0.7-0.95 sim, artist unknown channel, tier 2, no rel.
const s8 = scoreHit(buttera, {
  videoId: "vv8",
  title: "Butta Bomma Full Audio Song",
  artist: "Music Hub India",
  album: "n/a",
  durationSec: 220,
  views: 50000,
  tier: 2,
  rel: 0,
});
check("borderline upload accepts (30+24+0+3+0=57)", s8 !== null && s8 >= 48 && s8 < 62, s8, "57");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
