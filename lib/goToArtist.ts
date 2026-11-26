/**
 * "Open artist" — navigation event for the artist page (hero, Play/Shuffle,
 * the artist's song list). Mirrors the album pattern: anything in the app can
 * ask for an artist page without prop threading; page.tsx listens and pushes
 * the screen onto the real history stack, so the page's back arrow AND the
 * Android hardware Back both return where you came from.
 *
 * Collaboration credits are NEVER combined into one artist page (user's exact
 * ask: "Anirudh Ravichander & Jonita Gandhi" means two pages, not one) —
 * splitArtists() breaks the credit into individual names and every "Go to
 * artist" entry point offers one option per artist, so a tap opens THAT
 * artist's page alone.
 */
export const OPEN_ARTIST_EVENT = "wave:open-artist";

export function goToArtist(name: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string>(OPEN_ARTIST_EVENT, { detail: name }));
  }
}

/**
 * A collaboration credit ("A & B", "A, B", "A feat. B") → the individual
 * artist names, in credit order. Splits on the separators YT credits actually
 * use — comma, semicolon, ampersand, feat./ft./featuring — then trims, drops
 * empties and case-insensitive duplicates. A single-artist string comes back
 * untouched, so the menus render exactly one entry per artist everywhere.
 */
export function splitArtists(artist: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const parts = (artist || "").split(/\s*(?:,|;|&|\bfeaturing\b|\bfeat\b\.?|\bft\b\.?)\s*/i);
  for (const part of parts) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
