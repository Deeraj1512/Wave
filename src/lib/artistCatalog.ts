/**
 * Artist catalog — the names + faces behind the home Radio shelf and the
 * onboarding artist-pick step.
 *
 * Three jobs:
 *  1. radioArtists() — whose circles show on the shelf. Your top listening
 *     artists come first (the taste brain, history.topArtists); the shelf is
 *     padded with a curated cross-language list of widely-known artists so a
 *     brand-new user sees a full Radio row instead of an empty block.
 *  2. artistImage() — the artist's real FACE for each circle. This used to be
 *     the top song's album art, which put MOVIE POSTERS in the circles (Raees
 *     behind Arijit Singh, Remo behind Anirudh — the user's screenshot bug).
 *     Now: yt/artistPhoto (YTM artist avatar → Deezer press photo) first,
 *     song art only as the very last resort. Persisted in localStorage so a
 *     photo is fetched once, ever (cache bumped to v2 — v1 held poster urls).
 *  3. onboardArtists() — the per-language candidate grid for onboarding.
 */

import { artistPhotoApi, searchApi } from "./api";
import { catalogTracks } from "./catalog";
import { topArtists } from "./history";
import { profileArtists } from "./profile";
import type { Track } from "./types";

/** Diacritic-strip + lowercase + whitespace collapse — the artist matching key. */
export function fold(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Onboarding artist candidates, per language — the faces the user picks their
 * favorites from ("choose ~20 favorite artists per language"). All real,
 * widely-known names, so artistPhoto() resolves an actual face for every card.
 * The same list seeds the Radio shelf's cold start (DEFAULT_RADIO_ARTISTS).
 */
export const ONBOARDING_ARTISTS: Record<string, string[]> = {
  Hindi: [
    "Arijit Singh", "Shreya Ghoshal", "Pritam", "Atif Aslam", "Sonu Nigam",
    "Sunidhi Chauhan", "Neha Kakkar", "Jubin Nautiyal", "Shankar Mahadevan",
    "Alka Yagnik", "Udit Narayan", "Armaan Malik", "Shilpa Rao", "Mohit Chauhan",
    "Darshan Raval", "KK",
  ],
  Telugu: [
    "Sid Sriram", "S. P. Balasubrahmanyam", "Devi Sri Prasad", "Ram Miriyala",
    "Anurag Kulkarni", "Chinmayi Sripaada", "Kaala Bhairava", "Geetha Madhuri",
    "Sunitha", "Hemachandra", "Yazin Nizar", "L. V. Revanth", "Sithara",
    "Harika Narayan", "Nutana Mohan", "Sunidhi Chauhan",
  ],
  Tamil: [
    "Anirudh Ravichander", "A.R. Rahman", "Yuvan Shankar Raja", "Harris Jayaraj",
    "Dhanush", "Sid Sriram", "Chinmayi Sripaada", "Shreya Ghoshal", "Hariharan",
    "Santhosh Narayanan", "Sean Roldan", "G.V. Prakash Kumar", "D. Imman",
    "Anthony Daasan", "Sathyaprakash", "Pradeep Kumar",
  ],
  Punjabi: [
    "Diljit Dosanjh", "AP Dhillon", "Karan Aujla", "Guru Randhawa", "B Praak",
    "Ammy Virk", "Jassie Gill", "Harrdy Sandhu", "Gurdas Maan", "Sunanda Sharma",
    "Ranjit Bawa", "Shubh", "Nimrat Khaira", "Sippy Gill",
  ],
  Kannada: [
    "Vijay Prakash", "Ananya Bhat", "Sanjith Hegde", "Sonu Nigam", "Shreya Ghoshal",
    "V. Harikrishna", "Ajaneesh Loknath", "Ravi Basrur", "Charan Raj",
    "Vasuki Vaibhav", "Chaitra H G", "Siddharth Mahadevan",
  ],
  Malayalam: [
    "K. S. Chithra", "K. J. Yesudas", "Shaan Rahman", "Vineeth Sreenivasan",
    "Vijay Yesudas", "Shreya Ghoshal", "Manjari", "Sachin Warrier",
    "Sooraj Santhosh", "Niranj Suresh", "Job Kurian", "Bijibal",
  ],
  Bengali: [
    "Anupam Roy", "Shreya Ghoshal", "Arijit Singh", "Rupankar Bagchi",
    "Iman Chakraborty", "Shaan", "Monali Thakur", "Nakash Aziz", "Rupam Islam",
  ],
  English: [
    "Ed Sheeran", "Taylor Swift", "The Weeknd", "Coldplay", "Billie Eilish",
    "Eminem", "Bruno Mars", "Ariana Grande", "Justin Bieber", "Dua Lipa",
  ],
};

/**
 * Curated cold-start artists, per language. ONLY radio seeds — tap → search the
 * name → play their top song as the seed. Names are real, widely-known artists;
 * nothing here is a claim about catalog contents.
 */
export const DEFAULT_RADIO_ARTISTS: Array<{ name: string; lang: string }> = [
  { name: "Arijit Singh", lang: "Hindi" },
  { name: "Sid Sriram", lang: "Telugu" },
  { name: "Anirudh Ravichander", lang: "Tamil" },
  { name: "Shreya Ghoshal", lang: "Hindi" },
  { name: "A.R. Rahman", lang: "Tamil" },
  { name: "S. P. Balasubrahmanyam", lang: "Telugu" },
  { name: "Devi Sri Prasad", lang: "Telugu" },
  { name: "Yuvan Shankar Raja", lang: "Tamil" },
  { name: "Diljit Dosanjh", lang: "Punjabi" },
  { name: "AP Dhillon", lang: "Punjabi" },
  { name: "Vijay Prakash", lang: "Kannada" },
  { name: "Ananya Bhat", lang: "Kannada" },
  { name: "K. S. Chithra", lang: "Malayalam" },
  { name: "Shaan Rahman", lang: "Malayalam" },
  { name: "Anupam Roy", lang: "Bengali" },
  { name: "Pritam", lang: "Hindi" },
];

/**
 * The onboarding candidate grid for one language — up to `limit` names.
 */
export function onboardArtists(lang: string, limit = 16): string[] {
  return (ONBOARDING_ARTISTS[lang] ?? []).slice(0, limit);
}

/** Is `track` sung (at least partly) by `artistName`? Folded, prefix-tolerant. */
export function isArtistTrack(track: Track, artistName: string): boolean {
  const target = fold(artistName);
  if (!target) return false;
  return track.artist
    .split(",")
    .map((a) => fold(a))
    .some((a) => a === target || (target.length > 3 && a.includes(target)));
}

/**
 * The Radio shelf's artist list — up to `limit` names. Your onboarding picks
 * lead, then your listening history, curated defaults fill the rest so the
 * shelf is never half-empty.
 */
export function radioArtists(limit = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const k = fold(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(name);
  };
  try {
    // onboarding favorites first — the user TOLD us these matter
    for (const a of profileArtists()) {
      if (out.length >= limit) break;
      push(a);
    }
    for (const a of topArtists(12)) {
      if (out.length >= limit) break;
      push(a);
    }
  } catch {
    /* no history yet — cold start below fills the shelf */
  }
  for (const d of DEFAULT_RADIO_ARTISTS) {
    if (out.length >= limit) break;
    push(d.name);
  }
  return out;
}

// ── artist photo resolution (the FACE, cached forever) ───────────────────────

const IMG_KEY = "wave.artistImg.v4"; // v1-v3 held pre-fix results — v4 re-resolves through the face ladder
const imgCache = new Map<string, string>(); // folded name → url ("" = tried, none)
let imgHydrated = false;
const inflight = new Map<string, Promise<string | undefined>>();

/**
 * Concurrency gate for FACE resolutions — the onboarding grid fires ~16 at
 * once, and a full parallel burst of YTM artist searches gets throttled (measured:
 * several circles fell back to song art). Max 3 in flight keeps every circle a
 * real face without meaningfully slowing the grid (~300ms each, 3-wide).
 */
const FACE_INFLIGHT_MAX = 3;
let faceActive = 0;
const faceQueue: Array<() => void> = [];
async function faceSlot<T>(job: () => Promise<T>): Promise<T> {
  if (faceActive >= FACE_INFLIGHT_MAX) {
    await new Promise<void>((resume) => faceQueue.push(resume));
  }
  faceActive++;
  try {
    return await job();
  } finally {
    faceActive--;
    faceQueue.shift()?.();
  }
}

function imgStore(): Map<string, string> {
  if (!imgHydrated && typeof window !== "undefined") {
    imgHydrated = true;
    try {
      for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(IMG_KEY) ?? "{}") as Record<string, string>)) {
        imgCache.set(k, v);
      }
    } catch {
      /* fresh install */
    }
  }
  return imgCache;
}

function saveImgs() {
  try {
    localStorage.setItem(IMG_KEY, JSON.stringify(Object.fromEntries(imgCache)));
  } catch {
    /* best-effort */
  }
}

/**
 * Photo URL for the artist circle — the artist's real FACE. Ladder:
 *   1. localStorage cache (resolved once, ever)
 *   2. yt/artistPhoto — YouTube Music's artist avatar (the face, verified live:
 *      "Arijit Singh" resolves his concert portrait, not the Raees poster)
 *      → Deezer press photo when YTM has none
 *   3. their top song's album art (the old stand-in, LAST resort only)
 * Resolves undefined when nothing was found (negative-cached, never re-fetched).
 */
export function artistImage(name: string): Promise<string | undefined> {
  const key = fold(name);
  if (!key) return Promise.resolve(undefined);
  const hit = imgStore().get(key);
  if (hit !== undefined) return Promise.resolve(hit || undefined);
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      // source 1+2: the real face — through the runtime-correct lane (web → the
      // /api/artist-img server route, APK → the in-process YTM→Deezer chain);
      // the browser can NOT call music.youtube.com itself (no CORS). Gated to 3
      // in flight so a grid burst never trips YouTube's throttling.
      let face: string | undefined;
      try {
        face = await faceSlot(() => artistPhotoApi(name));
      } catch {
        face = undefined; // transient (5xx / offline) — NOT cached, retried next mount
      }
      if (face) {
        imgCache.set(key, face);
        saveImgs();
        return face;
      }
      const byArtist = (t: Track) => isArtistTrack(t, name);
      // source 3 (last resort): session catalog art — already fetched, zero network cost
      const cat = await catalogTracks().catch(() => [] as Track[]);
      const inCat = cat.find((t) => t.cover && byArtist(t));
      if (inCat?.cover) {
        imgCache.set(key, inCat.cover);
        saveImgs();
        return inCat.cover;
      }
      // source 4 (last resort, uncached session): live search — their top song's art
      const res = await searchApi(name).catch(() => [] as Track[]);
      const match = res.find((t) => t.cover && byArtist(t)) ?? res.find((t) => t.cover);
      if (match?.cover) {
        imgCache.set(key, match.cover);
        saveImgs();
        return match.cover;
      }
      imgCache.set(key, ""); // negative cache — never re-fetch a miss
      saveImgs();
      return undefined;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
