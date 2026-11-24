/**
 * Client API layer — the single swap point between the UI and the Wave backend
 * (which is Echo-Music's streaming strategy ported to our server).
 *
 * Two runtimes, one interface:
 *  - WEB  (browser / deployed site): calls hit our Next.js /api routes, which
 *    run the Echo chain server-side and proxy googlevideo (needed there because
 *    stream URLs are IP-bound to the minter — the server).
 *  - NATIVE (Android APK via Capacitor): there IS no server. The device runs
 *    the very same Echo chain in-process (src/lib/yt/* is isomorphic) and plays
 *    googlevideo URLs it minted itself — same IP, no proxy needed. Capacitor's
 *    CapacitorHttp patches fetch to native HTTP, so CORS never applies.
 */
import type { Track } from "./types";
import { colorFor } from "./data";
import { detectTrackLang, inferLiveLang, guessLangFromWords } from "./langs";
import { recentPlays, topArtists } from "./history";
import { rankedTasteLangs } from "./profile";

/** True inside the Capacitor Android/iOS shell (APK), false in any browser. */
export const IS_NATIVE: boolean =
  typeof window !== "undefined" &&
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export interface ApiTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  views: number;
  tier: number;
  thumb?: string;
  /** query-match score from the server rank — lets taste refine without overriding it */
  rel?: number;
}

/** Album entity (an MPREb_ browse target) surfaced by search / album-name search. */
export interface ApiAlbum {
  browseId: string;
  title: string;
  artist: string;
  year?: string;
  thumb?: string;
}

interface SearchResponse {
  query: string;
  tracks: ApiTrack[];
  albums?: ApiAlbum[];
  dropped: Record<string, number>;
  attempts: string[];
  cached?: boolean;
  error?: string;
}

/**
 * Display-title cleaner for video-tier results: YTM OMV/UGC titles carry upload noise —
 * "Butta Bomma Video Song 8K | Ala Vaikunthapurramuloo | Allu Arjun | …". Keep the song
 * name, drop promo words and pipe-separated metadata. Matching/search still uses the
 * raw title (server-side); this only affects what the UI shows.
 */
function displayTitle(raw: string): string {
  let s = raw.replace(/\s*\(From[^)]*\)/i, "").trim();
  if (s.includes("|")) {
    const head = s.split("|")[0].trim();
    const PROMO = /\b(video\s?song|full\s?song|full\s?video|lyrical\s?video|lyrical|official\s?(?:video|audio|song)|audio\s?song|4k|8k|hd)\b/gi;
    if (head.length >= 3) {
      const cleaned = head.replace(PROMO, "").replace(/\s{2,}/g, " ").trim();
      if (cleaned.length >= 3) s = cleaned;
    }
  }
  // uploaders decorate titles ("✷Raavana Mavandaa") — strip leading non-word symbols
  s = s.replace(/^[^\p{L}\p{N}"'(\[]+/u, "").trim();
  // YTM ATV titles carry language markers — noise in the UI (we show lang separately)
  s = s.replace(/\s*\((?:tamil|telugu|hindi|malayalam|kannada|punjabi|bengali|marathi|bhojpuri)\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
  // "(Version, 1)" style ATV duplicates marker
  s = s.replace(/\s*\((?:version|ver\.?|deluxe|updated),?\s*\w{0,6}\)?\s*$/i, "").trim();
  // "ROOH - Hindi Indie Acoustic Love Song" — self-promo genre suffix after a dash
  s = s.replace(/\s*[–—-]\s*(?:hindi|punjabi|tamil|telugu|malayalam|kannada)?\s*(?:indie|acoustic|unplugged|lofi|sad|love|romantic|melody)?\s*(?:indie|acoustic|unplugged|lofi|sad|love|romantic|melody)?\s*(?:song|version|mix|cover)\s*$/i, "").trim();
  return s;
}

export function apiTrackToTrack(t: ApiTrack): Track {
  const cleanTitle = displayTitle(t.title);
  const named = t.artist.replace(/\s*-\s*Topic\s*$/i, "").trim() || t.artist;
  return {
    id: t.videoId,
    title: cleanTitle || t.title,
    // "Unknown artist" is a parsing placeholder, not a credit — blank it; surfaces
    // fall back to the album name, and no subtitle reads cleaner than a fake one.
    artist: named === "Unknown artist" ? "" : named,
    album: t.album || "Single",
    duration: t.durationSec,
    lang: detectLang(t),
    year: 0,
    plays: t.views >= 1e9 ? `${(t.views / 1e9).toFixed(1)}B` : t.views >= 1e6 ? `${Math.round(t.views / 1e6)}M` : `${Math.round(t.views / 1e3)}K`,
    // Key the procedural palette on the ALBUM (then artwork, then id): every
    // version of the same poster glows identically — same art, same background
    // (videoId hashing gave identical covers unrelated washes).
    colors: colorFor(t.album || t.thumb || t.videoId),
    cover: t.thumb,
  };
}

/**
 * Language is only shown when we KNOW it. Live YTM results carry no language field,
 * so we trust explicit "(Hindi)"/"(Telugu)"-style markers in the title/album plus
 * native-script titles (Telugu/Tamil/… Unicode blocks), then movie/album names from
 * the live catalog (near-unique per industry). Artist-dominant inference is
 * FORBIDDEN here: a multilingual artist's dominant language (Sid Sriram → Telugu)
 * is a prior about the artist, not evidence about a single song — stamping it on
 * every track once leaked his Hindi songs into a Telugu-only feed as "Telugu".
 * The strict feed ladder (langs.trackLangOf) applies artist evidence only when
 * decisive, and only as the last resort.
 */
function detectLang(t: ApiTrack): Track["lang"] {
  return detectTrackLang(t) ?? inferLiveLang({ title: t.title, album: t.album, artist: t.artist }, undefined, { noArtist: true }) ?? guessLangFromWords(`${t.title} ${t.album}`);
}

// ── taste re-ranking (the "results follow MY taste" rule) ───────────────────

function foldName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The listener's language profile — how many plays went to each language
 * (recent history, play-count weighted), PLUS the onboarding profile's picks
 * with a pick-order floor. This is "the priority he listens which type of
 * language": a user who lives in Telugu gets Telugu results ranked above the
 * rest, at EQUAL query relevance — and a fresh install with a profile (say,
 * Telugu picked first, English never) is already fully taste-ranked from its
 * very first search.
 */
function tasteLangWeights(): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    for (const p of recentPlays(60)) {
      // lang was frozen at play time (exact for catalog + live-inferred tracks);
      // detectTrackLang is the fallback for older entries without one
      const l = p.lang ?? detectTrackLang({ title: p.title });
      if (!l) continue;
      counts.set(l, (counts.get(l) ?? 0) + Math.max(1, p.n ?? 1));
    }
  } catch {
    /* fresh install — the profile floor below still applies */
  }
  // profile picks: #1 carries the strongest floor, later picks slightly less
  // (min 1) — enough to outrank any un-listened language, never enough to beat
  // a genuinely dominating listening phase of another chosen language
  try {
    rankedTasteLangs(counts).forEach((l, i) => {
      counts.set(l, Math.max(counts.get(l) ?? 0, Math.max(1, 6 - i)));
    });
  } catch {
    /* no profile yet */
  }
  return counts;
}

/** "812M" / "4.2B" / "96K" → the numeric play count (0 when unparseable). */
function playsNum(plays: string): number {
  const m = /^([\d.]+)\s*([KMB]?)$/i.exec((plays || "").trim());
  if (!m) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/**
 * Languages that count as "Indian" for the language-barrier rule. The user's
 * standing requirement: a language he never listens to must never float above
 * Indian songs — English results sink below everything Indian, even when their
 * query match is technically stronger.
 */
const INDIAN_LANGS = new Set(["Hindi", "Tamil", "Telugu", "Punjabi", "Kannada", "Malayalam", "Bengali"]);

/**
 * Re-rank search results — YouTube's feel with the listener's taste.
 * THE USER'S RULE, in his own words: "search for the songs the user listens
 * upon the taste the user listens — those songs should be prioritized. The
 * user listens to Indian songs, no English — English songs on top should not
 * happen."
 *
 *   1. TYPED MATCH TIER     — the song being typed (exact title ≫ title extends
 *                             the phrase ≫ phrase inside title, rel ≥ 4500)
 *                             stays absolutely on top. Typing beats taste.
 *   2. LANGUAGE BARRIER     — the languages the user ACTUALLY listens to come
 *                             first, ordered by listening weight; Indian
 *                             languages he doesn't listen to hold a small
 *                             floor (still Indian); unknown = neutral middle;
 *                             a foreign never-listened language (English)
 *                             sinks below EVERYTHING — never above Indian songs.
 *   3. query relevance      — within a language group, the better query match
 *                             wins (YouTube's relevance inside the taste lanes).
 *   4. familiar artists     — the user's own top artists next.
 *   5. MOST-PLAYED on top   — play counts decide the tail: most played first,
 *                             least played at the bottom of the list.
 */
export function tasteRank(tracks: Track[], rels: number[]): Track[] {
  try {
    const fam = new Set(topArtists(10).map((a) => foldName(a)).filter(Boolean));
    const langW = tasteLangWeights();
    if (fam.size === 0 && langW.size === 0) return tracks;
    const bucket = (rel: number) => (rel >= 9000 ? 4 : rel >= 4500 ? 3 : rel >= 1800 ? 2 : rel > 0 ? 1 : 0);
    const scored = tracks.map((t, i) => {
      const primary = (t.artist || "").split(",")[0].trim().toLowerCase();
      let taste = 0;
      if (primary && fam.has(primary)) taste += 3;
      else if (primary && [...fam].some((f) => f.includes(primary) || primary.includes(f))) taste += 1;
      // Language barrier ladder: listened language by play weight (100-199,
      // compressed so any listened language beats any non-listened one) ·
      // Indian-not-listened floor +1 · unknown 0 · foreign -1 (the sink).
      let langBoost = 0;
      if (t.lang) {
        const w = langW.get(t.lang);
        langBoost = w !== undefined ? 100 + Math.min(99, w) : INDIAN_LANGS.has(t.lang) ? 1 : -1;
      }
      const relB = bucket(rels[i] ?? 0);
      // "The song I'm typing" — exact/prefix/phrase-in-title — must top the
      // list no matter what; taste orders everything below it.
      const typed = relB >= 3 ? 1 : 0;
      return { t, typed, langBoost, relB, views: playsNum(t.plays), taste, i };
    });
    scored.sort(
      (a, b) =>
        b.typed - a.typed ||
        b.langBoost - a.langBoost ||
        b.relB - a.relB ||
        b.taste - a.taste ||
        b.views - a.views ||
        a.i - b.i
    );
    return scored.map((x) => x.t);
  } catch {
    return tracks;
  }
}

export async function searchApi(q: string, signal?: AbortSignal): Promise<Track[]> {
  if (IS_NATIVE) {
    // APK: no backend — run the identical originals-only YTM search in-process.
    const { searchOriginals } = await import("./yt/search");
    const data = await searchOriginals(q);
    return tasteRank(
      data.tracks.map(mapApiTrack),
      data.tracks.map((t) => t.rel ?? 0)
    );
  }
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  return tasteRank(
    data.tracks.map(mapApiTrack),
    data.tracks.map((t) => t.rel ?? 0)
  );
}

const mapApiTrack = (t: ApiTrack): Track => apiTrackToTrack(t);

// ── Albums (Innertube access: entity search + exact album page) ─────────────

/** Song + album entities for the search screen (albums ride along when the
 *  server's response carried them; the Albums tab fetches a dedicated
 *  entity search itself when this list is empty). */
export async function searchFullApi(
  q: string,
  signal?: AbortSignal
): Promise<{ tracks: Track[]; albums: ApiAlbum[] }> {
  if (IS_NATIVE) {
    const { searchOriginals } = await import("./yt/search");
    const data = await searchOriginals(q);
    return {
      tracks: tasteRank(
        data.tracks.map(mapApiTrack),
        data.tracks.map((t) => t.rel ?? 0)
      ),
      albums: data.albums ?? [],
    };
  }
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  return {
    tracks: tasteRank(
      data.tracks.map(mapApiTrack),
      data.tracks.map((t) => t.rel ?? 0)
    ),
    albums: data.albums ?? [],
  };
}

/** Album entities for a name ("type the album, find the album"). */
export async function albumSearchApi(q: string, artist?: string): Promise<ApiAlbum[]> {
  const pack = (a: {
    browseId: string;
    title: string;
    artist: string;
    year?: string;
    thumb?: string;
  }): ApiAlbum => ({ browseId: a.browseId, title: a.title, artist: a.artist, year: a.year, thumb: a.thumb });
  if (IS_NATIVE) {
    const { searchAlbums } = await import("./yt/album");
    const list = await searchAlbums(q);
    return list.map(pack);
  }
  const p = new URLSearchParams({ q });
  if (artist) p.set("artist", artist);
  const res = await fetch(`/api/album?${p.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { album?: ApiAlbum; albums?: ApiAlbum[] };
  if (data.album) return [pack(data.album)];
  return (data.albums ?? []).map(pack);
}

export interface AlbumBrowseResult {
  album: ApiAlbum;
  tracks: Track[];
}

function packAlbumDetail(d: {
  browseId: string;
  title: string;
  artist: string;
  year?: string;
  thumb?: string;
  tracks: Array<{ videoId: string; title: string; artist: string; album: string; durationSec: number }>;
}): AlbumBrowseResult {
  return {
    album: { browseId: d.browseId, title: d.title, artist: d.artist, year: d.year, thumb: d.thumb },
    tracks: d.tracks.map((t) =>
      apiTrackToTrack({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: d.title,
        durationSec: t.durationSec,
        views: 0,
        tier: 1,
        thumb: d.thumb,
      })
    ),
  };
}

/** The EXACT album page for an MPREb_ browse id — real tracklist, real credits. */
export async function albumBrowseApi(browseId: string): Promise<AlbumBrowseResult | null> {
  if (IS_NATIVE) {
    const { browseAlbum } = await import("./yt/album");
    const d = await browseAlbum(browseId);
    return d ? packAlbumDetail(d) : null;
  }
  const res = await fetch(`/api/album?browseId=${encodeURIComponent(browseId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { album?: Parameters<typeof packAlbumDetail>[0] };
  return data.album ? packAlbumDetail(data.album) : null;
}

export interface VideoAlbumResolution {
  /** The exact album page when YouTube's linkage + browse landed it. */
  page: AlbumBrowseResult | null;
  /** The REAL album name YouTube reports for this video (when no page landed) —
   *  the only name worth trying in a fallback ladder. */
  albumName?: string;
}

/**
 * The EXACT album behind a SONG (videoId) — YouTube's own song→album linkage
 * from the watch-next seed row (MPREb_ run), then the album page browse.
 * This replaced name-guessing: "Chitti" by title search resolved a junk
 * 229-play album of the same name; the linkage lands "Jathi Ratnalu" exactly.
 */
export async function albumForVideoApi(videoId: string): Promise<VideoAlbumResolution> {
  if (IS_NATIVE) {
    const { albumOfVideo, resolveAlbumForVideo } = await import("./yt/album");
    const page = await resolveAlbumForVideo(videoId).catch(() => null);
    if (page) return { page: packAlbumDetail(page) };
    const link = await albumOfVideo(videoId).catch(() => null);
    return { page: null, albumName: link?.albumName };
  }
  try {
    const res = await fetch(`/api/album?videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) return { page: null };
    const data = (await res.json()) as { album?: Parameters<typeof packAlbumDetail>[0]; albumName?: string | null };
    if (data.album) return { page: packAlbumDetail(data.album) };
    return { page: null, albumName: data.albumName ?? undefined };
  } catch {
    return { page: null };
  }
}

// ── Search suggestions (YouTube typing behavior) ────────────────────────────

export async function suggestApi(q: string): Promise<string[]> {
  if (IS_NATIVE) {
    const { searchSuggestions } = await import("./yt/suggest");
    return searchSuggestions(q);
  }
  try {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: string[] };
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

// ── Radio (autoplay layer) ────────────────────────────────────────────────────

/**
 * `meta` (title/artist) powers the server's search fallback when the RDAMVM Mix
 * endpoint is bot-gated — without it an empty Mix means an empty queue.
 */
export async function radioApi(
  seedVideoId: string,
  meta?: { title?: string; artist?: string }
): Promise<Track[]> {
  if (IS_NATIVE) {
    // APK: the RDAMVM Mix queue resolved locally through the same filter pipeline.
    const { radioFor } = await import("./yt/radio");
    const data = await radioFor(seedVideoId, meta);
    return data.tracks.map((t) =>
      apiTrackToTrack({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
        views: t.views,
        tier: t.tier,
        thumb: t.thumb,
      })
    );
  }
  const p = new URLSearchParams();
  if (meta?.title) p.set("title", meta.title);
  if (meta?.artist) p.set("artist", meta.artist);
  const qs = p.toString();
  const res = await fetch(`/api/radio/${seedVideoId}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`radio ${res.status}`);
  const data = (await res.json()) as { tracks: ApiTrack[] };
  return data.tracks.map(apiTrackToTrack);
}

// ── Batch album art for seed-catalog tracks ──────────────────────────────────

type ThumbSignal = { id: string; title: string; artist: string };

/** Resolve cover art for tracks that don't have one (mock seed tracks). Fire-and-forget batching. */
export async function thumbsApi(items: ThumbSignal[]): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  if (IS_NATIVE) {
    // APK: same lookup the /api/thumbs route does server-side — originals-only
    // search per item, first tier hit with art — cached for the app session.
    const { searchOriginals } = await import("./yt/search");
    const covers: Record<string, string> = {};
    const pending = items.filter((x) => x?.id && x?.title && !thumbCache.has(keyOf(x.title, x.artist)));
    for (const x of pending) thumbCache.set(keyOf(x.title, x.artist), null); // reserve
    for (let i = 0; i < pending.length; i += 6) {
      const chunk = pending.slice(i, i + 6);
      await Promise.all(
        chunk.map(async (item) => {
          try {
            const artistFirst = item.artist.split(",")[0].trim();
            const res = await searchOriginals(`${item.title} ${artistFirst}`);
            const best = res.tracks.find((t) => t.thumb && t.durationSec >= 60) ?? res.tracks.find((t) => t.thumb);
            if (best?.thumb) {
              thumbCache.set(keyOf(item.title, item.artist), best.thumb);
              covers[item.id] = best.thumb;
            }
          } catch {
            thumbCache.delete(keyOf(item.title, item.artist)); // retried next session
          }
        })
      );
    }
    return covers;
  }
  const res = await fetch("/api/thumbs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`thumbs ${res.status}`);
  const data = (await res.json()) as { covers: Record<string, string> };
  return data.covers ?? {};
}

const thumbCache = new Map<string, string | null>(); // queryKey -> cover url | null

function keyOf(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.split(",")[0].toLowerCase().trim()}`;
}

/** Audio proxy URL — server resolves via Echo's client chain (+sibling fallback).
 *  `codec` = what the device can decode; `quality` = the sound-quality mode
 *  ("high" = max bitrate lane, "saver" = data-friendly lane). */
export function audioUrlFor(
  id: string,
  title?: string,
  artist?: string,
  duration?: number,
  codec?: "aac" | "opus",
  quality?: "high" | "saver"
): string {
  const p = new URLSearchParams();
  if (title) p.set("title", title);
  if (artist) p.set("artist", artist);
  if (duration) p.set("dur", String(Math.round(duration)));
  if (codec) p.set("codec", codec);
  if (quality) p.set("quality", quality);
  const qs = p.toString();
  return `/api/audio/${id}${qs ? `?${qs}` : ""}`;
}

/**
 * Does THIS browser play webm/opus? Chromium (Android WebView, Chrome, Edge)
 * does — those sessions get the 160 kbps opus lane. Safari answers "" and
 * keeps the universal m4a lane.
 */
export function browserSupportsOpus(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const a = document.createElement("audio");
    return !!a.canPlayType && a.canPlayType('audio/webm; codecs="opus"') !== "";
  } catch {
    return false;
  }
}

// ── Artist photo (the FACE, not the song art) ────────────────────────────────

/**
 * Real artist portrait (Radio shelf circles, onboarding grid, Artist page).
 * WEB: the browser cannot call music.youtube.com in-process (no CORS), so the
 * resolution runs on our server through /api/artist-img. NATIVE (APK):
 * CapacitorHttp patches fetch → no CORS → the identical chain runs in-process.
 * Result: the artist's face wherever their music is sold/streamed — verified
 * live ("Arijit Singh" → his concert portrait, not the Raees poster).
 */
export async function artistPhotoApi(name: string): Promise<string | undefined> {
  if (!name?.trim()) return undefined;
  if (IS_NATIVE) {
    const { artistPhoto } = await import("./yt/artistPhoto");
    return artistPhoto(name).catch(() => undefined);
  }
  // THROWS on transport failure (5xx / offline) so the caller knows the attempt
  // was transient and must not cache a fallback; undefined = clean "no face".
  const res = await fetch(`/api/artist-img?name=${encodeURIComponent(name.trim())}`);
  if (!res.ok) throw new Error(`artist-img ${res.status}`);
  const data = (await res.json()) as { url?: string | null };
  return data.url ?? undefined;
}

// ── Native audio (APK) — the Echo chain runs on-device ───────────────────────

export interface NativeStream {
  url: string;
  client: string;
  viaSibling: boolean;
}

/**
 * Resolve a playable googlevideo URL on-device: same client chain, probe and
 * sibling fallback as the server's /api/audio route, minus the proxy hop —
 * the URL is minted from THIS device's IP, so googlevideo serves it directly
 * to the <audio> element (media elements need no CORS).
 *
 * NATIVE ONLY: in a plain browser music.youtube.com sends no CORS headers, so
 * this chain's fetches are doomed — the player only calls this when IS_NATIVE.
 * Hard contract: resolves to null on ANY failure — it must never throw into
 * the player (an escaping rejection here was the app's "Failed to fetch" crash).
 */
export async function resolveNativeAudio(
  id: string,
  title?: string,
  artist?: string,
  duration?: number
): Promise<NativeStream | null> {
  try {
    const { resolveStreamSmart } = await import("./yt/resolve");
    const r = await resolveStreamSmart(id, {
      title,
      artist,
      durationSec: duration ? Math.round(duration) : undefined,
    });
    if (!r) return null;
    return { url: r.url, client: r.client, viaSibling: r.viaSibling };
  } catch {
    return null; // resolve is best-effort — callers fall back cleanly
  }
}

/** Drop cached stream URLs for a track (googlevideo 403/expiry → force fresh resolve). */
export async function invalidateNativeAudio(id: string, clientName?: string): Promise<void> {
  try {
    const { invalidateStream } = await import("./yt/resolve");
    invalidateStream(id, clientName);
  } catch {
    /* cache clearing is best-effort */
  }
}
