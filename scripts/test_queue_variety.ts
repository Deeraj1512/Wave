/**
 * Logic test for the queue variety engine (queueVariety.ts) — run with bun.
 * Mocks window/localStorage, then verifies the Option A rules end-to-end.
 */
// minimal browser shim
const store = new Map<string, string>();
(globalThis as any).window = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

const {
  rememberHeard,
  filterFresh,
  heardAt,
  isStaleSession,
  FRESH_WINDOW_MS,
} = require("/home/z/my-project/src/lib/queueVariety.ts");

const mk = (id: string) => ({ id, title: t(id), artist: "X", album: "", duration: 200, year: 0, plays: "", colors: ["#000", "#111"] });
const titles = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const t = (id: string) => titles[parseInt(id.slice(1)) % 10] ?? id;

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}`); } };

// 1. never-heard tracks pass the fresh filter
const pool = ["v0","v1","v2","v3","v4","v5","v6","v7"].map(mk);
check("never-heard pool passes untouched", filterFresh(pool).length === 8);

// 2. tracks heard within 10h (same day) still pass — continuity
rememberHeard(["v0", "v1"]);
check("same-day heard tracks pass (continuity)", filterFresh(pool).length === 8);

// 3. tracks heard >10h ago are excluded — next-day variety
// record v0/v1 while the clock is shifted 10h+ into the future → they are
// "heard yesterday" relative to the real now
const realNow = Date.now.bind(Date);
Date.now = () => realNow() - FRESH_WINDOW_MS - 60_000;
rememberHeard(["v0", "v1"]);
Date.now = realNow;
const filtered = filterFresh(pool);
check("yesterday's heard tracks excluded", filtered.length === 6 && !filtered.some((x: any) => x.id === "v0" || x.id === "v1"));

// 4. thin pool relaxes the filter — queue never starves
const tiny = ["v0","v1","v2"].map(mk);
check("thin pool (<minKeep) relaxes the filter", filterFresh(tiny, 6).length === 3);

// 5. staleness rule: 8h
const now = Date.now();
check("session 1h old = fresh", isStaleSession(now - 3600_000) === false);
check("session 9h old = stale", isStaleSession(now - 9 * 3600_000) === true);
check("session at missing = not stale", isStaleSession(undefined) === false);

// 6. heardAt reflects memory
rememberHeard("v9");
check("heardAt remembers plays", heardAt("v9") !== null);
check("heardAt null for unknown", heardAt("zzz") === null);

// 7. cap logic mirror (same algorithm as player.tsx capArtists) — max 2 per artist, seed 3
function capArtists(pool: any[], seedArtist: string) {
  const ARTIST_CAP = 2, SEED_CAP = 3;
  const seedKeys = new Set(seedArtist.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean));
  const counts = new Map<string, number>();
  const out: any[] = [];
  for (const tr of pool) {
    const parts = tr.artist.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean);
    const key = parts[0] || tr.artist.toLowerCase();
    const isSeed = parts.some((a: string) => seedKeys.has(a));
    const cap = isSeed ? SEED_CAP : ARTIST_CAP;
    const n = counts.get(key) ?? 0;
    if (n >= cap) continue;
    counts.set(key, n + 1);
    out.push(tr);
  }
  return out;
}
const oneArtist = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, title: `t${i}`, artist: "Sushin Shyam", album: "", duration: 200, year: 0, plays: "", colors: ["#000", "#111"] }));
check("artist capped at 3 (seed artist)", capArtists(oneArtist, "Sushin Shyam").length === 3);
const mixed = [...oneArtist, ...Array.from({ length: 6 }, (_, i) => ({ id: `y${i}`, title: `u${i}`, artist: i % 2 ? "Arijit Singh" : "Shreya Ghoshal", album: "", duration: 200, year: 0, plays: "", colors: ["#000", "#111"] }))];
const capped = capArtists(mixed, "Sushin Shyam");
const arijit = capped.filter((x) => x.artist === "Arijit Singh").length;
check("other artists capped at 2", arijit === 2 && capped.length === 7);

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
