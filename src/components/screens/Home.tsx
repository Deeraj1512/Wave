"use client";

/**
 * Home feed — two sources only: YOUR data (history, likes) and the live server.
 * Layout is a verbatim YouTube Music home: chips → More to explore (paged 4-row
 * lists, swipe left for the next 4) → Quick picks (3×3 Speed dial matrix) →
 * Listen again → Mixed for you → Trending → Liked songs.
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
import { Play } from "lucide-react";
import { Shelf } from "../Shelf";
import { SongCard, QuickPick, SpeedDialTile } from "../Cards";
import { usePlayer } from "@/lib/player";
import { colorFor, MOOD_CHIPS } from "@/lib/data";
import { searchApi, radioApi } from "@/lib/api";
import { recentPlays, radioSeed, subscribeHistory, historyVersion, seededRandom, seededShuffle, type RecentPlay } from "@/lib/history";
import { catalogTracks } from "@/lib/catalog";
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

/** History entry → playable Track (duration/plays unknown; cards don't show them). */
function histToTrack(h: RecentPlay): Track {
  return {
    id: h.id,
    title: h.title,
    artist: h.artist,
    album: "",
    duration: 0,
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
 * The listener's dominant language, derived from their OWN play history matched
 * against the live catalog's lang data (history entries don't store lang).
 * Weighted by play count + recency, so a current Telugu phase outweighs an old
 * Hindi one. Returns null when there's no signal yet (cold start → the generic
 * mood query runs with zero language bias instead of a fake default).
 */
function dominantLang(plays: RecentPlay[], catalog: Track[]): Lang | null {
  const langById = new Map<string, Lang>();
  const langByKey = new Map<string, Lang>();
  for (const t of catalog) {
    if (!t.lang) continue;
    langById.set(t.id, t.lang);
    langByKey.set(keyOf(t), t.lang);
  }
  const score = new Map<Lang, number>();
  const now = Date.now();
  for (const p of plays) {
    const lang =
      langById.get(p.id) ??
      langByKey.get(`${p.title.toLowerCase().trim()}|${(p.artist.split(",")[0] || "").toLowerCase().trim()}`);
    if (!lang) continue;
    const recency = 1 + Math.max(0, 1 - (now - p.at) / (21 * 864e5)); // 1..2, fades over 3 weeks
    score.set(lang, (score.get(lang) ?? 0) + Math.min(p.n, 12) * recency);
  }
  let best: Lang | null = null;
  let bestScore = 0;
  for (const [lang, s] of score) {
    if (s > bestScore) {
      best = lang;
      bestScore = s;
    }
  }
  return best;
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
    radioApi(seedInfo.id)
      .then((ts) => alive && setRadioPool(uniq(ts.filter((t) => t.id !== seedInfo.id))))
      .catch(() => alive && setRadioPool([]));
    return () => {
      alive = false;
    };
  }, [seedInfo]);

  // Taste language — snapshotted once per mount (like seedInfo) so mid-session
  // plays never re-roll the mood mixes under the user's eyes. undefined = still
  // resolving, null = no signal (cold start).
  const [tasteLang, setTasteLang] = useState<Lang | null | undefined>(undefined);
  useEffect(() => {
    if (!mounted || !discPool || tasteLang !== undefined) return;
    setTasteLang(dominantLang(recentPlays(40), discPool));
  }, [mounted, discPool, tasteLang]);

  // "Radio for you" — the personal radio shelf (hidden while loading / when empty).
  const because = useMemo(() => {
    if (!seedInfo || !radioPool || radioPool.length === 0) return null;
    return { label: seedInfo.title, tracks: radioPool.slice(0, 12) };
  }, [seedInfo, radioPool]);

  // ── Quick picks: replays + personal radio + a few discoveries, re-mixed per
  //    refresh; the previous refresh's exact set is excluded. ─────────────────
  const [qp, setQp] = useState<Track[] | null>(null);
  useEffect(() => {
    if (!discPool || !radioPool) return; // pools still loading → skeleton
    const replays = uniq(recentPlays(24).map(histToTrack)).slice(0, 6);
    const takenIds = new Set(replays.map((t) => t.id));
    const radioTracks = uniq(radioPool.filter((t) => !takenIds.has(t.id))).slice(0, 14);
    for (const t of radioTracks) takenIds.add(t.id);

    // Anchored mix: mostly yours + 3 outside discoveries. Cold start (no history):
    // a pure discovery blend sampled song-by-song across the whole catalog.
    const extraPool = discPool.filter((t) => !takenIds.has(t.id));
    const source =
      replays.length > 0 || radioTracks.length > 0
        ? [...replays, ...radioTracks, ...seededShuffle(extraPool, rnd).slice(0, 3)]
        : extraPool;

    const last = lastIds(QP_LAST);
    let mix = seededShuffle(uniq(source), rnd).filter((t) => !last.has(t.id));
    if (mix.length < 18) mix = seededShuffle(uniq([...mix, ...discPool]), rnd).slice(0, 18);
    const picks = mix.slice(0, 18); // two full 3×3 speed-dial pages
    saveIds(QP_LAST, picks);
    setQp(picks);
  }, [discPool, radioPool, rnd]);

  // ── Fresh picks: another re-roll, disjoint from Quick picks AND its own last set.
  //    Mood chips steer it as mood intent + YOUR language (from play history) —
  //    never a hard-coded language. Falls back to the plain mood query only if
  //    the language-prefixed one comes back empty. ──
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
          if (ts.length === 0 && q !== base) ts = await searchApi(base).catch(() => []);
          if (alive) setFresh(ts.slice(0, 10));
        } catch {
          if (alive) setFresh([]);
        }
      })();
      return () => {
        alive = false;
      };
    }
    if (!discPool || !radioPool) return;
    const exclude = new Set([...lastIds(QP_LAST), ...lastIds(FRESH_LAST)]);
    const radioPart = seededShuffle(uniq(radioPool).filter((t) => !exclude.has(t.id)), rnd);
    const radioIds = new Set(radioPart.map((t) => t.id));
    const discPart = seededShuffle(discPool.filter((t) => !exclude.has(t.id) && !radioIds.has(t.id)), rnd);
    let mix = seededShuffle(uniq(radioPool.length > 0 ? [...radioPart.slice(0, 6), ...discPart.slice(0, 4)] : discPart), rnd);
    if (mix.length < 12) {
      const ids = new Set(mix.map((t) => t.id));
      mix = [...mix, ...seededShuffle(discPool.filter((t) => !ids.has(t.id)), rnd)];
    }
    const picks = mix.slice(0, 12); // three full 4-row explore pages
    saveIds(FRESH_LAST, picks);
    setFresh(picks);
  }, [mood, tasteLang, discPool, radioPool, rnd]);

  // ── Trending (live chart — no editorial fallback: hidden until it arrives) ──
  const [trending, setTrending] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    searchApi("trending songs india")
      .then((ts) => alive && setTrending(ts.slice(0, 10)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
