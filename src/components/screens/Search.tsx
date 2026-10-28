"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Clock, Disc3, Play, Search, WifiOff, X } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { Cover } from "../Cover";
import { useCover } from "@/lib/covers";
import { GENRE_TILES } from "@/lib/data";
import { searchApi } from "@/lib/api";
import { groupAlbums, registerAlbum } from "@/lib/albums";
import type { Track } from "@/lib/types";
import { AlbumView } from "./AlbumView";

const RECENT_KEY = "dhun.recentSearches";
const RECENT_CAP = 8;

function loadRecent(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(arr)) return [];
    const raw = arr.filter((x): x is string => typeof x === "string" && x.length > 0);
    // Collapse progressive-typing chains ("ne","nena","nenani" → "nenani"):
    // an entry that is a strict prefix of a longer entry is just typing noise.
    return raw.filter((r) => {
      const rl = r.toLowerCase();
      return !raw.some((o) => o.length > rl.length && o.toLowerCase().startsWith(rl));
    });
  } catch {
    return [];
  }
}

/** Commit a search — called on Enter or when a result is tapped, never per keystroke. */
function pushRecent(q: string) {
  const ql = q.toLowerCase();
  const next = [q, ...loadRecent().filter((r) => {
    const rl = r.toLowerCase();
    if (rl === ql) return false;
    return !(ql.startsWith(rl) && rl.length < ql.length); // replace its own shorter prefixes
  })].slice(0, RECENT_CAP);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function SearchScreen({ initialQuery, seedKey }: { initialQuery?: string; seedKey?: number }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // A search is remembered only when the user COMMITS to it (Enter / taps a result) —
  // live-typing partials must never pollute the recent-searches chips.
  const commitRecent = (override?: string) => {
    const query = (override ?? q).trim();
    if (!query) return;
    setRecent(pushRecent(query));
  };

  // real recent searches — restored after mount (hydration-safe), updated on success
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    // deferred so the restore is an update, not a sync setState inside the effect body
    const id = setTimeout(() => setRecent(loadRecent()), 0);
    return () => clearTimeout(id);
  }, []);

  // Explore tiles / deep links seed the query — render-time state adjustment
  // (React's recommended pattern), then focus after commit.
  const [appliedSeed, setAppliedSeed] = useState<number | undefined>(undefined);
  if (seedKey !== appliedSeed) {
    setAppliedSeed(seedKey);
    if (initialQuery) setQ(initialQuery);
  }
  useEffect(() => {
    if (seedKey !== undefined && initialQuery) inputRef.current?.focus();
  }, [seedKey, initialQuery]);

  // Real search through the Wave backend — no mock fallback. A failed search shows
  // an honest error (scoped to the query it failed for) instead of fake results.
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<{ q: string } | null>(null);
  useEffect(() => {
    const query = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (!query) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchApi(query, ctrl.signal)
        .then((ts) => {
          setResults(ts);
          setFailure(null);
          setSearching(false);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setResults([]);
          setFailure({ q: query });
          setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Album search — "type the album, find its songs": group the results by their
  // parsed album byline; the Albums tab shows these as cards.
  const albums = useMemo(() => groupAlbums(results, q), [results, q]);
  // Opening an album page swaps the results view; the key is scoped to the query
  // it was opened from, so typing a new query returns to results (render-time
  // adjustment — no effect needed).
  const [openAlbum, setOpenAlbum] = useState<{ key: string; q: string } | null>(null);
  const albumOpen = openAlbum && openAlbum.q === q ? openAlbum.key : null;

  // Result tabs — "Songs" is the classic track list, "Albums" narrows to album
  // cards. The tab row only exists while a query is active.
  const [tab, setTab] = useState<"songs" | "albums">("songs");
  const switchTab = (t: "songs" | "albums") => {
    setTab(t);
    if (openAlbum) setOpenAlbum(null); // leaving the album page via the tabs
  };

  return (
    <div className="space-y-8 pb-8">
      {/* Search bar */}
      <div className="sticky top-0 z-10 -mx-4 bg-[var(--bg)] px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 transition focus-within:bg-surface-3">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRecent();
            }}
            placeholder="Search songs, albums, artists…"
            className="w-full bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            aria-label="Search"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-3">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        {q.trim() && (
          <div className="mt-3 flex items-center gap-2" role="tablist" aria-label="Search result type">
            {(["songs", "albums"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => switchTab(t)}
                className={
                  tab === t
                    ? "rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-bold text-black transition hover:bg-white/90"
                    : "rounded-full border border-border bg-surface-2 px-4 py-1.5 text-[13px] font-semibold text-foreground/80 transition hover:bg-surface-3"
                }
              >
                {t === "songs" ? "Songs" : "Albums"}
              </button>
            ))}
            {searching && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" aria-label="Searching" />
            )}
          </div>
        )}
      </div>

      {q.trim() ? (
        // ── Results view ── (any result tap commits the current query to recents)
        <div onClickCapture={() => commitRecent()}>
        {albumOpen ? (
          <AlbumView id={albumOpen} onBack={() => setOpenAlbum(null)} />
        ) : searching && results.length === 0 ? (
          <div className="space-y-2 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl px-3 py-2">
                <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-surface-3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-3" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        ) : failure && failure.q === q.trim() ? (
          <div className="py-16 text-center">
            <WifiOff className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-4 text-lg font-bold">Couldn&apos;t search just now</p>
            <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again — your query is still in the box.</p>
          </div>
        ) : results.length > 0 ? (
          tab === "albums" ? (
            albums.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {albums.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => {
                      registerAlbum(a.key, a.tracks);
                      setOpenAlbum({ key: a.key, q });
                      commitRecent(q);
                    }}
                    className="group rounded-2xl p-3 text-left transition hover:bg-surface-2"
                    aria-label={`Open album ${a.name}`}
                  >
                    <span className="relative block aspect-square w-full overflow-hidden rounded-xl shadow-lg shadow-black/30">
                      {a.cover ? (
                        <img src={a.cover} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                      ) : (
                        <Cover from={a.tracks[0].colors[0]} to={a.tracks[0].colors[1]} seed={a.tracks[0].id} className="h-full w-full" />
                      )}
                      <span className="absolute inset-0 flex items-end justify-start bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100">
                        <span className="flex h-10 w-10 m-3 items-center justify-center rounded-full bg-[var(--accent)] shadow-xl">
                          <Play className="h-4 w-4 fill-black text-black" />
                        </span>
                      </span>
                    </span>
                    <span className="mt-2.5 flex items-center gap-1.5">
                      <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Album</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-bold text-foreground">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.artist ? `${a.artist} · ` : ""}{a.tracks.length} song{a.tracks.length === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <Disc3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-bold">No albums for “{q}”</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This search matched songs only —{" "}
                  <button onClick={() => setTab("songs")} className="font-semibold text-[var(--accent)] underline underline-offset-2">
                    see songs
                  </button>
                </p>
              </div>
            )
          ) : (
            <div className="space-y-0.5">
              {results.map((t) => (
                <TrackRow key={t.id} track={t} radio />
              ))}
            </div>
          )
        ) : (
          <div className="py-16 text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-4 text-lg font-bold">No results for “{q}”</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a song name, artist, movie or language — maybe in Hinglish.</p>
          </div>
        )}
        </div>
      ) : (
        // ── Browse view ──
        <div className="space-y-9">
          {recent.length > 0 && (
            <section aria-label="Recent searches">
              <h2 className="mb-3 flex items-center gap-2 px-1 text-lg font-extrabold tracking-tight">
                <Clock className="h-4 w-4 text-muted-foreground" /> Recent searches
                <button
                  onClick={() => {
                    try {
                      localStorage.removeItem(RECENT_KEY);
                    } catch {}
                    setRecent([]);
                  }}
                  className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                  aria-label="Clear recent searches"
                >
                  Clear
                </button>
              </h2>
              <div className="flex flex-wrap gap-2 px-1">
                {recent.map((r) => (
                  <button
                    key={r}
                    onClick={() => setQ(r)}
                    className="rounded-full border border-border bg-surface-2 px-4 py-2 text-[13px] font-semibold text-foreground/85 transition hover:bg-surface-3"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-label="Browse all">
            <h2 className="mb-4 px-1 text-lg font-extrabold tracking-tight">Browse all</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {GENRE_TILES.map((g) => (
                <button key={g.name} onClick={() => setQ(g.name)} className="group relative overflow-hidden rounded-2xl p-4 text-left transition-transform hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }} aria-label={`Browse ${g.name}`}>
                  <p className="text-[15px] font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">{g.name}</p>
                  <div className="absolute -bottom-5 -right-5 h-20 w-20 rotate-12 rounded-2xl bg-black/25 backdrop-blur-[2px] transition-transform duration-300 group-hover:rotate-3" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
