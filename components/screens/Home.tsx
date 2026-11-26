"use client";

/**
 * Home feed — two sources only: YOUR data (history, likes) and the live server.
 * Layout: chips → More to explore (paged 4-row lists, swipe left for the next 4)
 * → Quick picks (3×3 Speed dial matrix) → Made for you (onboarding artists) →
 * Radio (artist profiles) → Listen again → Mixed for you → Trending → Liked songs.
 * No greeting header — the feed itself is the hello (user's call).
 *  - Quick picks = your replays + your personal-radio pool (seeded from your most
 *    played song, so the mix stays in YOUR musical universe) + a couple of outside
 *    discoveries — re-mixed on every page load. The songs change on every refresh;
 *    the language/taste anchor does NOT jump around (no Kannada-then-Hindi-then-
 *    Malayalam block rotation).
 *  - The exact set shown last refresh is remembered per tab and excluded, so every
 *    refresh visibly brings a new set of songs.
 *  - A shelf with nothing real to show simply doesn't render (or shows an honest
 *    loading skeleton while the fetch is in flight).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Music2, Play } from "lucide-react";
import { Shelf } from "../Shelf";
import { SongCard, QuickPick, SpeedDialTile } from "../Cards";
import { usePlayer } from "@/lib/player";
import { colorFor, MOOD_CHIPS } from "@/lib/data";
import { searchApi, radioApi } from "@/lib/api";
import { recentPlays, radioSeed, topArtists, subscribeHistory, historyVersion, seededRandom, seededShuffle, type RecentPlay } from "@/lib/history";
import { radioArtists, artistImage, isArtistTrack } from "@/lib/artistCatalog";
import { goToArtist } from "@/lib/goToArtist";
import { catalogTracks } from "@/lib/catalog";
import { getProfile, profileVersion, rankedTasteLangs, subscribeProfile } from "@/lib/profile";
import { strictLangFilter, feedLangs, roundRobin, familiarWeave, familiarSet, rotateBy } from "@/lib/taste";
import type { Track, Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

// Mood → search intent. Deliberately language-agnostic: the listener's language
// is prepended at fetch time from their own play history (see dominantLang),
// so a Telugu listener gets "telugu romantic songs" while a Punjabi listener
// gets "punjabi romantic songs" — mood mixes follow YOUR taste, never a fixed
// hard-coded language.
const MOOD_QUERY: Record<string, string> = {
  Romance: "romantic songs",
  Energize: "energetic hits",
  Sad: "sad songs",
  Workout: "workout motivation songs",
  Devotional: "devotional songs",
  Party: "party dance songs",
  Focus: "chill melodies",
  "Road trip": "road trip songs",
  Sleep: "calm sleep songs",
};

// ── Per-tab memory of the last rendered sets → a refresh never repeats them. ──
const QP_LAST = "wave.qp.last";
const FRESH_LAST = "wave.fresh.last";
const FORYOU_LAST = "wave.foryou.last";

function lastIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveIds(key: string, tracks: Track[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(tracks.map((t) => t.id)));
  } catch {
    /* private mode — exclusion simply doesn't persist */
  }
}

// ── Made-for-you cache — the shelf must never randomly vanish. ──
// localStorage (survives restarts, unlike the sessionStorage exclusion
// sets) holds the last SUCCESSFUL set, tagged with the profile it was
// built for. Every visit hydrates from it INSTANTLY and refreshes in the
// background; a failed or thin refresh keeps the cache on screen instead
// of erasing the shelf (the "comes and gone" bug the user reported).
const FORYOU_CACHE = "wave.foryou.cache.v2";

function readForYouCache(key: string): Track[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(FORYOU_CACHE) ?? "null") as { key: string; tracks: Track[] } | null;
    if (raw && raw.key === key && Array.isArray(raw.tracks) && raw.tracks.length > 0) return raw.tracks;
  } catch {
    /* corrupt cache = no cache */
  }
  return null;
}

function saveForYouCache(key: string, tracks: Track[]) {
  try {
    localStorage.setItem(FORYOU_CACHE, JSON.stringify({ key, tracks }));
  } catch {
    /* private mode — the shelf just rebuilds each visit */
  }
}

/** History entry → playable Track (duration/plays unknown; cards don't show them).
 *  The language frozen at play time rides along — the strict feed lock reads it. */
function histToTrack(h: RecentPlay): Track {
  return {
    id: h.id,
    title: h.title,
    artist: h.artist,
    album: "",
    duration: 0,
    lang: h.lang as Track["lang"],
    year: 0,
    plays: "",
    colors: colorFor(h.id),
    cover: h.cover,
  };
}

/** Identity key collapses id-swaps (mock id ↔ videoId) of the same song. */
function keyOf(t: Track): string {
  return `${t.title.toLowerCase().trim()}|${(t.artist.split(",")[0] || t.album).toLowerCase().trim()}`;
}

/** First-wins dedupe by song identity, preserving order; drops empty titles. */
function uniq(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (!t.title) return false;
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Split a track list into fixed-size pages (4 rows / 9 dial cells per page). */
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Horizontal page-carousel plumbing shared by the paged home shelves: native
 * scroll-snap swiping (compositor-only — zero JS in the gesture path), the
 * active page index for the dots, and dot-tap paging. Step width is measured
 * from the first page element (+ flex gap), so both peek layouts (explore) and
 * full-bleed pages (speed dial) resolve to the same page math.
 *
 * Touch devices swipe natively; for mice we translate pointer drags into
 * scrollLeft (desktop otherwise has no way to swipe an overflow box), suppress
 * the click that follows a real drag, and smooth-snap to the nearest page on
 * release — CSS snap re-applies, so the resting positions stay exact.
 */
function usePagedCarousel(gapPx: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const drag = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const step = first.offsetWidth + gapPx;
    const idx = Math.min(Math.max(0, Math.round(el.scrollLeft / step)), Math.max(0, el.children.length - 1));
    setPage((p) => (p === idx ? p : idx)); // same-value updates bail out — no scroll-jank re-renders
  }, [gapPx]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return; // phones already swipe natively
    drag.current = { startX: e.clientX, startLeft: ref.current?.scrollLeft ?? 0, moved: false };
    // Kill the CSS smooth behavior for the gesture: per-move assignments must be
    // instantaneous (1:1 tracking) or the release-time scrollLeft read lags the
    // finger and snaps to the wrong page.
    if (ref.current) ref.current.style.scrollBehavior = "auto";
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 5) return;
    d.moved = true;
    if (ref.current) ref.current.scrollLeft = d.startLeft - dx;
  }, []);

  const onPointerEnd = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (ref.current) ref.current.style.scrollBehavior = ""; // restore CSS behavior
    if (!d?.moved) return;
    suppressClick.current = true;
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const step = first.offsetWidth + gapPx;
    const idx = Math.min(Math.max(0, Math.round(el.scrollLeft / step)), Math.max(0, el.children.length - 1));
    el.scrollTo({ left: idx * step, behavior: "smooth" });
  }, [gapPx]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const go = useCallback(
    (i: number) => {
      const el = ref.current;
      const first = el?.firstElementChild as HTMLElement | null;
      if (!el || !first) return;
      el.scrollTo({ left: i * (first.offsetWidth + gapPx), behavior: "smooth" });
    },
    [gapPx]
  );

  return { ref, page, onScroll, go, onPointerDown, onPointerMove, onPointerEnd, onClickCapture };
}

/** YTM's pill page dots — active page is a wide bright pill, others dim nubs. */
function PageDots({ count, page, go, label }: { count: number; page: number; go: (i: number) => void; label: string }) {
  if (count <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          onClick={() => go(i)}
          aria-label={`Go to ${label} page ${i + 1}`}
          aria-current={i === page ? "true" : undefined}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === page ? "w-5 bg-foreground" : "w-1.5 bg-foreground/30 hover:bg-foreground/55"
          )}
        />
      ))}
    </div>
  );
}

/**
 * The listener's language weights, derived from their OWN play history matched
 * against the live catalog's lang data (history entries don't store lang).
 * Weighted by play count + recency, so a current Telugu phase outweighs an old
 * Hindi one. Feeds rankedTasteLangs (profile picks merge on top, in pick
 * order) — an empty history with a profile still yields the picked order.
 */
function historyLangWeights(plays: RecentPlay[], catalog: Track[]): Map<string, number> {
  const langById = new Map<string, Lang>();
  const langByKey = new Map<string, Lang>();
  for (const t of catalog) {
    if (!t.lang) continue;
    langById.set(t.id, t.lang);
    langByKey.set(keyOf(t), t.lang);
  }
  const score = new Map<string, number>();
  const now = Date.now();
  for (const p of plays) {
    const lang =
      langById.get(p.id) ??
      langByKey.get(`${p.title.toLowerCase().trim()}|${(p.artist.split(",")[0] || "").toLowerCase().trim()}`) ??
      p.lang;
    if (!lang) continue;
    const recency = 1 + Math.max(0, 1 - (now - p.at) / (21 * 864e5)); // 1..2, fades over 3 weeks
    score.set(lang, (score.get(lang) ?? 0) + Math.min(p.n, 12) * recency);
  }
  return score;
}

function SkelQuickPicks() {
  return (
    <div className="mx-auto grid w-full max-w-[600px] grid-cols-3 gap-x-3 gap-y-4">
      {[...Array(9)].map((_, i) => (
        <div key={i}>
          <div className="aspect-square w-full animate-pulse rounded-lg bg-surface-2" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

/** "812M" → number, for picking the artist's most-played song as the radio seed. */
function playsToNum(p: string): number {
  const m = p.trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const mult = m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1;
  return (parseFloat(m[1]) || 0) * mult;
}

/**
 * Radio — the artist-profile shelf. Circular artist photos — your top
 * listening artists first, curated cross-language names for cold start.
 * Tap → opens the ARTIST PAGE (hero, Play/Shuffle, their song list) — the
 * user's exact ask: the list opens first; nothing auto-plays on the tap.
 */
function RadioShelf({ onArtist }: { onArtist: (name: string) => void }) {
  const [artists, setArtists] = useState<string[] | null>(null);
  const [imgs, setImgs] = useState<Record<string, string>>({});

  useEffect(() => {
    // defer out of the effect body (react-compiler: no sync setState in effects)
    const id = setTimeout(() => setArtists(radioArtists(10)), 0);
    return () => clearTimeout(id);
  }, []);

  // resolve photos lazily, one by one, cached in localStorage by artistImage()
  useEffect(() => {
    if (!artists) return;
    let alive = true;
    const fetchAt = (i: number) => {
      if (!alive || i >= artists.length) return;
      artistImage(artists[i])
        .then((url) => {
          if (alive && url) setImgs((m) => (m[artists[i]] ? m : { ...m, [artists[i]]: url }));
          fetchAt(i + 1);
        })
        .catch(() => fetchAt(i + 1));
    };
    fetchAt(0);
    return () => {
      alive = false;
    };
  }, [artists]);

  if (!artists || artists.length === 0) return null;
  return (
    <section aria-label="Radio">
      <div className="mb-4 px-1">
        <h2 className="text-xl font-medium text-foreground sm:text-[22px]">Radio</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Tap an artist to see their songs</p>
      </div>
      <div className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
        {artists.map((name) => {
          const img = imgs[name];
          return (
            <button
              key={name}
              onClick={() => onArtist(name)}
              className="flex w-20 shrink-0 flex-col items-center gap-2"
              aria-label={`See ${name} songs`}
            >
              <span className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2">
                {img ? (
                  <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Music2 className="h-7 w-7 text-muted-foreground/60" />
                )}
              </span>
              <span className="w-full truncate text-center text-xs font-medium text-foreground/85">{name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "More to explore" pages: 4 song rows per page, swipe left for the next 4.
 *  Peek layout — pages are 28px narrower than the column with a 12px gap, so a
 *  16px sliver of the next page's art shows at the screen edge (YTM's tell). */
function ExplorePages({ tracks, label }: { tracks: Track[]; label: string }) {
  const pages = useMemo(() => chunk(tracks, 4), [tracks]);
  const { ref, page, onScroll, go, onPointerDown, onPointerMove, onPointerEnd, onClickCapture } = usePagedCarousel(12);
  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        aria-label={label}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth select-none scroll-ps-4 px-4 sm:-mx-6 sm:scroll-ps-6 sm:px-6"
      >
        {pages.map((pt, i) => (
          <div key={i} className="w-[calc(100%_-_28px)] shrink-0 snap-start snap-always space-y-2">
            {pt.map((t) => (
              <QuickPick key={t.id} track={t} showPlays />
            ))}
          </div>
        ))}
      </div>
      <PageDots count={pages.length} page={page} go={go} label={label} />
    </div>
  );
}

/** "Quick picks" Speed dial: 3×3 art matrix, 9 per page, swipe for the next
 *  page; the dial keeps a comfortable centered width on desktop columns. */
function QuickPicksDial({ tracks }: { tracks: Track[] }) {
  const pages = useMemo(() => chunk(tracks, 9), [tracks]);
  const { ref, page, onScroll, go, onPointerDown, onPointerMove, onPointerEnd, onClickCapture } = usePagedCarousel(16);
  return (
    <div className="mx-auto w-full max-w-[600px]">
      <div
        ref={ref}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        aria-label="Quick picks speed dial"
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth select-none"
      >
        {pages.map((pt, i) => (
          <div key={i} className="grid w-full shrink-0 snap-start snap-always grid-cols-3 gap-x-3 gap-y-4">
            {pt.map((t) => (
              <SpeedDialTile key={t.id} track={t} />
            ))}
          </div>
        ))}
      </div>
      <PageDots count={pages.length} page={page} go={go} label="Quick picks" />
    </div>
  );
}

export function HomeScreen() {
  const { playTrack, likedTracks: likedTracksRaw } = usePlayer();
  const [mood, setMood] = useState("All");

  // Hydration safety: anything time-based, random-seeded, or localStorage-derived must
  // render deterministically on the server AND the first client render, then swap after
  // mount (a normal re-render — not a hydration conflict).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Taste profile — version-tracked so saving/retaking onboarding re-rolls the feed.
  const profV = useSyncExternalStore(subscribeProfile, profileVersion, () => 0);
  const profile = useMemo(() => (mounted ? getProfile() : null), [mounted, profV]);

  const histV = useSyncExternalStore(subscribeHistory, historyVersion, () => 0);
  // One random seed per mount → every full-page refresh re-rolls the discovery mix,
  // while staying stable across re-renders within the session.
  const rnd = useMemo(() => seededRandom(mounted ? (Math.random() * 0x7fffffff) | 0 : 0), [mounted]);
  const recent = useMemo(() => (mounted ? recentPlays(10) : []), [mounted, histV]);

  // Personal-radio seed, snapshotted once per mount so mid-session plays never
  // re-roll the shelves under the user's eyes (YTM home is static per load too).
  const [seedInfo, setSeedInfo] = useState<RecentPlay | null | undefined>(undefined);
  useEffect(() => {
    if (mounted) setSeedInfo(radioSeed());
  }, [mounted]);

  // ── Pools ─────────────────────────────────────────────────────────────────
  // Discovery pool: the shared live catalog (module-cached — one fetch per session).
  const [discPool, setDiscPool] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    catalogTracks()
      .then((ts) => alive && setDiscPool(ts))
      .catch(() => alive && setDiscPool([]));
    return () => {
      alive = false;
    };
  }, []);

  // Personal radio pool — recommendations anchored to the user's most-played song.
  // This is what keeps Quick picks inside the listener's own language/taste universe.
  const [radioPool, setRadioPool] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (seedInfo === undefined) return;
    if (!seedInfo) {
      setRadioPool([]); // no history yet — nothing to anchor to (cold start)
      return;
    }
    setRadioPool(null);
    radioApi(seedInfo.id, { title: seedInfo.title, artist: seedInfo.artist })
      .then((ts) => alive && setRadioPool(uniq(ts.filter((t) => t.id !== seedInfo.id))))
      .catch(() => alive && setRadioPool([]));
    return () => {
      alive = false;
    };
  }, [seedInfo]);

  // Taste languages — snapshotted once per mount (like seedInfo) so mid-session
  // plays never re-roll the mood mixes under the user's eyes. undefined = still
  // resolving, null = no signal at all (cold start, no profile either).
  // PROFILE FIRST: onboarding picks in pick order, then history weights. This
  // list drives ORDERING only (mood-query prefix) — the feed's
  // hard language lock reads feedLangs() (SELECTED languages only, below).
  const [tasteLangs, setTasteLangs] = useState<Lang[] | undefined>(undefined);
  useEffect(() => {
    if (!mounted || tasteLangs !== undefined) return;
    setTasteLangs(rankedTasteLangs(historyLangWeights(recentPlays(40), discPool ?? [])));
  }, [mounted, discPool, tasteLangs]);
  const tasteLang = tasteLangs === undefined ? undefined : (tasteLangs[0] ?? null);

  // The feed's STRICT language set: the languages the user SELECTED at
  // onboarding, in pick order (no profile → their own play history defines
  // it). History never adds languages here — a couple of stray plays must not
  // reopen a door the user closed. Every shelf below filters through it.
  const feedL = useMemo(() => (mounted ? feedLangs() : ([] as Lang[])), [mounted, profV, histV]);
  // The discovery catalog, already locked to the feed languages — every shelf
  // that draws discovery rows reads this slice, never the raw catalog.
  const discStrict = useMemo(() => (discPool ? strictLangFilter(discPool, feedL) : null), [discPool, feedL]);

  // "Radio for you" — the personal radio shelf (hidden while loading / when empty).
  // The personal radio queue is a YouTube mix — multilingual by nature — so the
  // strict lock keeps "Mixed for you" inside the SELECTED languages, hard.
  const because = useMemo(() => {
    if (!seedInfo || !radioPool || radioPool.length === 0) return null;
    const locked = strictLangFilter(radioPool, feedL);
    if (locked.length === 0) return null;
    return { label: seedInfo.title, tracks: locked.slice(0, 12) };
  }, [seedInfo, radioPool, feedL]);

  // ── Made for you: the onboarding promise, kept. Songs BY the picked favorite
  //    artists, in the picked languages, in pick order — round-robined across
  //    artists (no hogging), re-rolled per refresh, spotlight rotating daily,
  //    and history-weighted so artists you've actually played lead the cast.
  //    Sits just below Quick picks (user's exact placement). ──
  const [forYou, setForYou] = useState<Track[] | null>(null);
  useEffect(() => {
    if (!mounted) return;
    const p = getProfile();
    if (!p || p.skipped || p.artists.length === 0) {
      setForYou([]); // no picks → shelf honestly absent, defaults take over
      return;
    }
    let alive = true;
    // INSTANT HYDRATE — the last SUCCESSFUL set (tagged to this profile)
    // shows immediately; the refresh below only ever SWAPS it for a fresh
    // set. The shelf can no longer sit invisible while the network works,
    // and a failed refresh keeps what's on screen ("comes and gone" fix).
    const cacheKey = `${p.name}|${p.artists.map((a) => a.name).join("+")}|${p.langs.join("+")}`;
    const cached = readForYouCache(cacheKey);
    setForYou(cached ?? null); // cached set → visible at once; first run → honest skeleton
    (async () => {
      try {
        // cast: onboarding picks — each WITH the language it was picked under —
        // history-played artists bubbled up, day-rotated
        const played = new Set(topArtists(12).map((a) => a.trim().toLowerCase()));
        const cast = rotateBy(
          p.artists
            .map((a, i) => ({ name: a.name, lang: a.lang, w: (played.has(a.name.split(",")[0].trim().toLowerCase()) ? 2 : 0) + 1 / (i + 1) }))
            .sort((a, b) => b.w - a.w),
          Math.floor(Date.now() / 864e5)
        ).slice(0, 8);

        // fetch each featured artist's songs BIASED to the language they were
        // picked under ("sid sriram telugu songs"), then the STRICT language
        // lock keeps only ladder-PROVEN songs — a favorite's other-language
        // songs (Sid Sriram's Hindi behind a Telugu pick) never enter the feed.
        // NO presumption here: multilingual artists are the #1 leak shape, and
        // measured on live data the proven pools still hold 12-29 tracks each
        // (perArtist needs 7-16), so proven-only costs nothing.
        // per-artist headroom scales down as the cast grows, so a 1-artist
        // profile still fills the 7-page shelf (user wants 6-7 pages per
        // category, not 2-3).
        const perArtist = cast.length <= 2 ? 16 : 7;
        // PARALLEL — every artist's search fires together (this used to run
        // sequentially: 8 slow round-trips made the shelf feel missing most
        // of the time). One shy artist must not sink the shelf; allSettled
        // keeps the survivors.
        const settled = await Promise.allSettled(
          cast.map(async (c, ci) => {
            let res = await searchApi(`${c.name} ${c.lang} songs`);
            let theirs = strictLangFilter(
              res.filter((t) => t.duration >= 45 && isArtistTrack(t, c.name)),
              p.langs
            );
            if (theirs.length < 3) {
              // biased query came back thin — plain retry, same strict door
              const plain = await searchApi(`${c.name} songs`).catch(() => [] as Track[]);
              const strict2 = strictLangFilter(
                plain.filter((t) => t.duration >= 45 && isArtistTrack(t, c.name)),
                p.langs
              );
              if (strict2.length > theirs.length) theirs = strict2;
            }
            const pool = [...theirs].sort((a, b) => playsToNum(b.plays) - playsToNum(a.plays)).slice(0, perArtist);
            return { lang: c.lang, group: pool, ci };
          })
        );
        if (!alive) return;
        const built: Array<{ lang: Lang; group: Track[]; ci: number }> = [];
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value.group.length > 0) built.push(r.value);
        }

        // groups in LANGUAGE PICK ORDER, then artist weight — the shelf
        // breathes Telugu → Tamil → Telugu exactly the way the user ranked
        const langRank = new Map(p.langs.map((l, i) => [l, i]));
        built.sort((a, b) => (langRank.get(a.lang) ?? 99) - (langRank.get(b.lang) ?? 99) || a.ci - b.ci);
        const groups = built.map((b) => seededShuffle(b.group, rnd));

        const pool = roundRobin(groups, { take: 40 });
        // FINAL strict pass — bias + presumption already held at every pool,
        // this pass GUARANTEES it (defense in depth: the user's law is that no
        // unselected language ever reaches the feed, for any reason).
        const locked = strictLangFilter(pool, p.langs);
        const last = lastIds(FORYOU_LAST);
        let picks = locked.filter((t) => !last.has(t.id));
        if (picks.length < 16) picks = locked; // thin pool → a repeat beats an empty shelf
        picks = picks.slice(0, 28); // 7 swipe pages × 4 rows (user's ask)
        if (alive && picks.length > 0) {
          saveIds(FORYOU_LAST, picks);
          saveForYouCache(cacheKey, picks);
          setForYou(picks);
        } else if (alive && !cached) {
          setForYou([]); // nothing new AND nothing cached → honest empty; a cached shelf stays
        }
      } catch {
        if (alive && !cached) setForYou([]); // failed refresh → keep a hydrated cache
      }
    })();
    return () => {
      alive = false;
    };
  }, [mounted, profV, rnd]);

  // ── Quick picks: replays + personal radio + a few discoveries, re-mixed per
  //    refresh; the previous refresh's exact set is excluded. Every pool is
  //    locked to the SELECTED languages BEFORE mixing — the old "1-2 foreign
  //    at a time" trickle is retired: no Hindi behind a Telugu pick, ever. ──
  const [qp, setQp] = useState<Track[] | null>(null);
  useEffect(() => {
    if (!discStrict || !radioPool) return; // pools still loading → skeleton
    const replays = strictLangFilter(uniq(recentPlays(24).map(histToTrack)), feedL).slice(0, 12);
    const takenIds = new Set(replays.map((t) => t.id));
    const radioTracks = strictLangFilter(uniq(radioPool.filter((t) => !takenIds.has(t.id))), feedL).slice(0, 24);
    for (const t of radioTracks) takenIds.add(t.id);

    // Anchored mix: mostly yours + 10 outside discoveries (already locked —
    // discovery draws from the strict catalog slice). Cold start (no history):
    // a discovery blend sampled song-by-song across the locked catalog.
    const extraPool = discStrict.filter((t) => !takenIds.has(t.id));
    const source =
      replays.length > 0 || radioTracks.length > 0
        ? [...replays, ...radioTracks, ...seededShuffle(extraPool, rnd).slice(0, 10)]
        : extraPool;

    const last = lastIds(QP_LAST);
    let mix = seededShuffle(uniq(source), rnd).filter((t) => !last.has(t.id));
    if (mix.length < 63) mix = seededShuffle(uniq([...mix, ...extraPool]), rnd).slice(0, 63);
    // ongoing taste: the artists you picked / play most lead the dial — two
    // familiar songs for every outside discovery, still re-shuffled per refresh
    const fam = familiarSet();
    const isFam = (t: Track) => fam.has(t.artist.split(",")[0].trim().toLowerCase());
    const picks = familiarWeave(mix.filter(isFam), mix.filter((t) => !isFam(t)), 63); // seven full 3×3 speed-dial pages (user's ask: 6-7 pages per category)
    saveIds(QP_LAST, picks);
    setQp(picks);
  }, [discStrict, radioPool, rnd, feedL]);

  // ── Fresh picks: another re-roll, disjoint from Quick picks AND its own last set.
  //    Mood chips steer it as mood intent + YOUR language (from play history) —
  //    never a hard-coded language. The STRICT lock runs on every path: the
  //    language-prefixed mood query presumes its own language for undetectable
  //    rows; the plain fallback query does not. Falls back to the plain mood
  //    query only if the language-prefixed one comes back empty. ──
  const [fresh, setFresh] = useState<Track[] | null>(null);
  useEffect(() => {
    if (mood !== "All") {
      if (tasteLang === undefined) return; // taste still resolving → wait, don't fire a language-less guess
      let alive = true;
      setFresh(null);
      const base = MOOD_QUERY[mood] ?? mood.toLowerCase();
      const q = tasteLang ? `${tasteLang.toLowerCase()} ${base}` : base;
      (async () => {
        try {
          let ts = await searchApi(q);
          ts = strictLangFilter(ts, feedL, { presumptive: tasteLang ?? undefined });
          if (ts.length < 24 && q !== base) {
            const plain = await searchApi(base).catch(() => [] as Track[]);
            ts = [...ts, ...strictLangFilter(plain, feedL)]; // no presumption on the unprefixed query
          }
          if (alive) setFresh(seededShuffle(uniq(ts), rnd).slice(0, 28)); // 7 swipe pages × 4 rows
        } catch {
          if (alive) setFresh([]);
        }
      })();
      return () => {
        alive = false;
      };
    }
    if (!discStrict || !radioPool) return;
    const exclude = new Set([...lastIds(QP_LAST), ...lastIds(FRESH_LAST)]);
    const radioPart = seededShuffle(uniq(strictLangFilter(radioPool, feedL)).filter((t) => !exclude.has(t.id)), rnd);
    const radioIds = new Set(radioPart.map((t) => t.id));
    const discPart = seededShuffle(discStrict.filter((t) => !exclude.has(t.id) && !radioIds.has(t.id)), rnd);
    let mix = seededShuffle(uniq(radioPart.length > 0 ? [...radioPart.slice(0, 10), ...discPart.slice(0, 18)] : discPart), rnd);
    if (mix.length < 28) {
      const ids = new Set(mix.map((t) => t.id));
      mix = [...mix, ...seededShuffle(discStrict.filter((t) => !ids.has(t.id)), rnd)];
    }
    const picks = mix.slice(0, 28); // 7 swipe pages × 4 rows (user's ask); every pool already passed the strict lock
    saveIds(FRESH_LAST, picks);
    setFresh(picks);
  }, [mood, tasteLang, feedL, discStrict, radioPool, rnd]);

  // ── Trending — one live chart per SELECTED language, merged in pick order.
  //    The national "trending songs india" chart is a Hindi wall; a Telugu
  //    listener's trending shelf must be THEIR charts. Rows fetched under a
  //    language's own query may presume it for undetectable titles; rows the
  //    ladder detects as another language are dropped, hard. ──
  const [trending, setTrending] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (feedL.length > 0) {
          const top = feedL.slice(0, 3);
          const per = await Promise.allSettled(top.map((l) => searchApi(`${l.toLowerCase()} trending songs`)));
          const seen = new Set<string>();
          const merged: Track[] = [];
          for (let i = 0; i < top.length; i++) {
            const r = per[i];
            if (r.status !== "fulfilled") continue;
            for (const t of strictLangFilter(r.value, feedL, { presumptive: top[i] })) {
              if (seen.has(t.id)) continue;
              seen.add(t.id);
              merged.push(t);
            }
          }
          if (alive) setTrending(merged.slice(0, 10));
        } else {
          const ts = await searchApi("trending songs india");
          if (alive) setTrending(strictLangFilter(ts, feedL).slice(0, 10));
        }
      } catch {
        /* no editorial fallback: hidden until a fetch lands */
      }
    })();
    return () => {
      alive = false;
    };
  }, [feedL]);

  const leftOff = useMemo(() => recent.map(histToTrack), [recent]);
  const likedTracks = useMemo(() => (mounted ? likedTracksRaw : []), [mounted, likedTracksRaw]);

  return (
    <div className="space-y-10 pb-8">
      {/* Mood chips — the feed opens straight into the filter chips, YTM-style */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pt-2">
        {MOOD_CHIPS.map((m) => (
          <button
            key={m}
            onClick={() => setMood(m)}
            className={
              mood === m
                ? "shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition"
                : "shrink-0 rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-foreground/85 transition hover:bg-surface-3 hover:text-foreground"
            }
            aria-pressed={mood === m}
          >
            {m}
          </button>
        ))}
      </div>

      {/* More to explore — YTM's paged list shelf, now the FIRST shelf so
          mood-chip taps visibly re-roll it: 4 song rows per page (YTM's
          "Artist · 969M plays" sublines), swipe left for the next 4, thin
          next-page peek at the edge, pill page dots below. Hidden entirely
          when the fetch came back empty — never a blank shell. */}
      {(fresh === null || fresh.length > 0) && (
        <section aria-label={mood === "All" ? "More to explore" : `${mood} mix`}>
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="text-xl font-medium text-foreground sm:text-[22px]">
              {mood === "All" ? "More to explore" : `${mood} mix`}
            </h2>
            {fresh !== null && fresh.length > 0 && (
              <button
                onClick={() => fresh[0] && playTrack(fresh[0], fresh, mood === "All" ? "More to explore" : `${mood} mix`)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-foreground/90 transition hover:bg-surface-2"
              >
                <Play className="h-4 w-4" /> Play all
              </button>
            )}
          </div>
          {fresh === null ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
              ))}
            </div>
          ) : (
            <ExplorePages tracks={fresh} label={mood === "All" ? "More to explore" : `${mood} mix`} />
          )}
        </section>
      )}

      {/* Quick picks — YTM's Speed dial: a 3×3 matrix of square art tiles, 9 per
          page, swipe to the next page (pill dots below). Same re-mix contract as
          before: the set changes on every refresh, the taste anchor does not. */}
      {qp !== null && qp.length > 0 && (
        <section aria-label="Quick picks">
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="text-xl font-medium text-foreground sm:text-[22px]">Quick picks</h2>
            <button
              onClick={() => qp[0] && playTrack(qp[0], qp, "Quick picks")}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-foreground/90 transition hover:bg-surface-2"
            >
              <Play className="h-4 w-4" /> Play all
            </button>
          </div>
          <QuickPicksDial tracks={qp} />
        </section>
      )}
      {qp === null && <SkelQuickPicks />}

      {/* Made for you — the onboarding-picks shelf, placed just BELOW Quick
          picks (user's exact placement): their songs, their languages, in pick
          order. Hydrates from the cache instantly and refreshes in place —
          the skeleton shows only on a genuinely first, cache-less load.
          Hidden when the user skipped onboarding or there is genuinely
          nothing. */}
      {mounted && profile && !profile.skipped && forYou === null && (
        <div aria-hidden className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}
      {mounted && profile && !profile.skipped && forYou !== null && forYou.length > 0 && (
        <section aria-label="Made for you">
          <div className="mb-4 flex items-center justify-between px-1">
            <div>
              <h2 className="text-xl font-medium text-foreground sm:text-[22px]">Made for {profile.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {profile.langs.slice(0, 2).join(" · ")} mix · your favorite artists
              </p>
            </div>
            <button
              onClick={() => forYou[0] && playTrack(forYou[0], forYou, "Made for you")}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-foreground/90 transition hover:bg-surface-2"
            >
              <Play className="h-4 w-4" /> Play all
            </button>
          </div>
          <ExplorePages tracks={forYou} label="Made for you" />
        </section>
      )}

      {/* Radio — artist profiles; tap opens the artist's SONG LIST (the
          artist page — hero, Play, Shuffle). Nothing auto-plays from the
          shelf tap (user's exact ask). Still after the personal shelves,
          before Listen again. */}
      <RadioShelf onArtist={(n) => goToArtist(n)} />

      {/* Listen again — real history */}
      {leftOff.length > 0 && (
        <Shelf title="Listen again">
          {leftOff.map((t) => (
            <SongCard key={t.id} track={t} radio />
          ))}
        </Shelf>
      )}

      {/* Mixed for you — the personal radio, anchored to your top play */}
      {because && (
        <Shelf title="Mixed for you">
          {because.tracks.map((t) => (
            <SongCard key={t.id} track={t} radio />
          ))}
        </Shelf>
      )}

      {/* Trending — live chart, only when the server delivered it */}
      {trending && trending.length > 0 && (
        <Shelf title="Trending">
          {trending.map((t) => (
            <SongCard key={t.id} track={t} radio />
          ))}
        </Shelf>
      )}

      {/* Liked songs */}
      {likedTracks.length > 0 && (
        <Shelf title="Liked songs">
          {likedTracks.map((t) => (
            <SongCard key={t.id} track={t} context={likedTracks} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
