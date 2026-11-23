/**
 * Simulates extendRadio's shaping for a Telugu seed on the REAL backend:
 * raw mix → shapeForMode("all") → relateBlock → dedupe/slice(15).
 * Prints language distribution before/after so the drift fix is measurable.
 */
import { detectTrackLang } from "../src/lib/langs";

interface ApiTrack { videoId: string; title: string; artist: string; album: string; durationSec: number; }
const BASE = "http://localhost:3000";

// — copies of the pure shapers in player.tsx (browser-free verification) —
function promoteSeedArtist(seed: { artist: string }, pool: ApiTrack[]): ApiTrack[] {
  const keys = new Set(seed.artist.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
  if (keys.size === 0) return pool;
  const same: ApiTrack[] = []; const rest: ApiTrack[] = [];
  for (const t of pool) {
    const match = t.artist.split(",").some((a) => keys.has(a.trim().toLowerCase()));
    if (match && same.length < 5) same.push(t); else rest.push(t);
  }
  return [...same, ...rest];
}

const TITLE_NOISE_RE = /\s*\((?:from[^)]*|\b\d{4}\b|telugu|hindi|tamil|kannada|malayalam|punjabi|bengali|english|version|reprised?|unplugged|acoustic|lo-?fi)\)\s*|\s[-–]\s*(?:telugu|hindi|tamil|kannada|malayalam)\s*$/gi;
function baseTitle(title: string): string { return title.replace(TITLE_NOISE_RE, " ").replace(/\s+/g, " ").trim().toLowerCase(); }

function relateBlock(seed: ApiTrack, pool: ApiTrack[]): ApiTrack[] {
  const lang = detectTrackLang({ title: seed.title, album: seed.album });
  if (!lang) return promoteSeedArtist(seed, pool);
  const seedBase = baseTitle(seed.title);
  const isVariant = (t: ApiTrack) => baseTitle(t.title) === seedBase;
  const dt = (t: ApiTrack) => detectTrackLang({ title: t.title, album: t.album });
  const same = pool.filter((t) => dt(t) === lang && !isVariant(t));
  const unknown = pool.filter((t) => dt(t) === undefined && !isVariant(t));
  const other = pool.filter((t) => { const l = dt(t); return (l !== undefined && l !== lang) || isVariant(t); });
  const head = promoteSeedArtist(seed, same);
  const tail = same.length + unknown.length >= 10 ? promoteSeedArtist(seed, unknown) : promoteSeedArtist(seed, [...unknown, ...other]);
  return [...head, ...tail];
}

async function main() {
  const q = process.argv[2] ?? "massa massa telugu";
  const sr = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()) as { tracks: ApiTrack[] };
  const seed = sr.tracks.find((t) => /telugu/i.test(t.title)) ?? sr.tracks[0];
  if (!seed) throw new Error("no seed found");
  const seedLang = detectTrackLang({ title: seed.title, album: seed.album });
  console.log(`SEED: ${seed.title} — ${seed.artist}  [lang=${seedLang ?? "?"}]  id=${seed.videoId}\n`);

  const rr = await fetch(`${BASE}/api/radio/${seed.videoId}`).then((r) => r.json()) as { tracks: ApiTrack[] };
  const pool = rr.tracks;
  const dt = (t: ApiTrack) => detectTrackLang({ title: t.title, album: t.album });

  const dist = (ts: ApiTrack[]) => {
    const m = new Map<string, number>();
    for (const t of ts) { const l = dt(t) ?? "unknown"; m.set(l, (m.get(l) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join("  ");
  };

  console.log(`RAW MIX (${pool.length}):`, dist(pool));
  const shaped = relateBlock(seed, pool).filter((t) => t.videoId !== seed.videoId).slice(0, 15);
  console.log(`SHAPED FIRST 15:`, dist(shaped), "\n");
  for (const [i, t] of shaped.entries()) console.log(`${String(i + 1).padStart(2)}. [${(dt(t) ?? "?").padEnd(7)}] ${t.title} — ${t.artist}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
