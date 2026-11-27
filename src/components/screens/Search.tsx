"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Clock, Disc3, Loader2, Mic2, Play, Search, WifiOff, X } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { Cover } from "../Cover";
import { GENRE_TILES } from "@/lib/data";
import {
  searchFullApi,
  albumSearchApi,
  albumBrowseApi,
  artistSearchApi,
  suggestApi,
  apiTrackToTrack,
  type ApiAlbum,
  type ApiArtistEntity,
  type ApiTopEntity,
} from "@/lib/api";
import { groupAlbums, registerAlbum } from "@/lib/albums";
import { useToast } from "@/hooks/use-toast";
import { usePlayer } from "@/lib/player";
import type { Track } from "@/lib/types";
import { goToArtist } from "@/lib/goToArtist";
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

/** One album card — either an Innertube entity (browseId → exact page) or a
 *  legacy search-group fallback (pre-collected tracks). */
interface AlbumCard {
  key: string;
  name: string;
  artist?: string;
  year?: string;
  thumb?: string;
  browseId?: string;
  tracks?: Track[];
  cover?: string;
  colors?: [string, string];
  seed?: string;
  count?: number;
}

/** Diacritic-strip + lowercase + whitespace collapse — stable keys for entities. */
function foldKey(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function SearchScreen({ initialQuery, seedKey }: { initialQuery?: string; seedKey?: number }) {
  const { toast } = useToast();
  const { playRadio } = usePlayer();
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
  // One request feeds ALL three tabs (YTM page model): songs + album entities +
  // artist entities + YTM's own top-result card. Tab switching never refetches.
  const [results, setResults] = useState<Track[]>([]);
  const [albumEntities, setAlbumEntities] = useState<ApiAlbum[]>([]);
  const [artistEntities, setArtistEntities] = useState<ApiArtistEntity[]>([]);
  const [top, setTop] = useState<ApiTopEntity | null>(null);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<{ q: string } | null>(null);
  const [tab, setTab] = useState<"songs" | "albums" | "artists">("songs");
  const switchTab = (t: "songs" | "albums" | "artists") => {
    setTab(t);
    if (openAlbum) setOpenAlbum(null); // leaving the album page via the tabs
  };
  useEffect(() => {
    const query = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (!query) {
        setResults([]);
        setAlbumEntities([]);
        setArtistEntities([]);
        setTop(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchFullApi(query, ctrl.signal)
        .then(({ tracks, albums, artists, top: card }) => {
          setResults(tracks);
          setAlbumEntities(albums);
          setArtistEntities(artists);
          setTop(card);
          setFailure(null);
          setSearching(false);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setResults([]);
          setAlbumEntities([]);
          setArtistEntities([]);
          setTop(null);
          setFailure({ q: query });
          setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // ── Suggestions — YouTube's typing behavior: 2 letters in, the song comes
  //    back as a tappable completion. Never blocks or breaks search. ──
  const [sugs, setSugs] = useState<string[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setSugs([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      suggestApi(query)
        .then((s) => alive && setSugs(s.slice(0, 10)))
        .catch(() => alive && setSugs([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Album groups from the song results (legacy lane, still useful when the
  // entity shelf didn't arrive) — merged with the REAL Innertube album entities.
  const grouped = useMemo(() => groupAlbums(results, q), [results, q]);

  const albumCards: AlbumCard[] = useMemo(() => {
    const out: AlbumCard[] = [];
    const seen = new Set<string>();
    for (const a of albumEntities) {
      const k = a.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, name: a.title, artist: a.artist, year: a.year, thumb: a.thumb, browseId: a.browseId });
    }
    for (const g of grouped) {
      if (seen.has(g.key)) continue;
      seen.add(g.key);
      out.push({
        key: g.key,
        name: g.name,
        artist: g.artist,
        tracks: g.tracks,
        cover: g.cover,
        count: g.tracks.length,
        colors: g.tracks[0].colors,
        seed: g.tracks[0].id,
      });
    }
    return out.slice(0, 12);
  }, [albumEntities, grouped]);

  // Opening an album page swaps the results view; the key is scoped to the query
  // it was opened from, so typing a new query returns to results (render-time
  // adjustment — no effect needed).
  const [openAlbum, setOpenAlbum] = useState<{ key: string; q: string } | null>(null);
  const albumOpen = openAlbum && openAlbum.q === q ? openAlbum.key : null;

  // Opening an Innertube album entity = one browse roundtrip — busy state per card.
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const openCard = async (card: AlbumCard) => {
    if (openingKey) return;
    if (card.browseId) {
      setOpeningKey(card.key);
      try {
        const page = await albumBrowseApi(card.browseId);
        if (!page || page.tracks.length === 0) throw new Error("empty album");
        const k1 = card.key;
        const k2 = page.album.title.toLowerCase().replace(/\s+/g, " ").trim();
        registerAlbum(k1, page.tracks);
        if (k2 && k2 !== k1) registerAlbum(k2, page.tracks);
        setOpenAlbum({ key: k1, q });
        commitRecent(q);
      } catch {
        toast({ title: "Couldn't open this album", description: "Check your connection and try again", duration: 3000 });
      } finally {
        setOpeningKey(null);
      }
      return;
    }
    if (card.tracks) {
      registerAlbum(card.key, card.tracks);
      setOpenAlbum({ key: card.key, q });
      commitRecent(q);
    }
  };

  // Albums tab with nothing? One dedicated entity search for the typed name —
  // "type the album, find the album" must always work, even when the song
  // search short-circuited confident (albums shelf absent).
  const lastAlbumQuery = useRef<string>("");
  useEffect(() => {
    const query = q.trim();
    if (tab !== "albums" || albumCards.length > 0 || !query || searching) return;
    if (lastAlbumQuery.current === query) return;
    lastAlbumQuery.current = query;
    let alive = true;
    albumSearchApi(query)
      .then((list) => {
        if (alive && list.length > 0) setAlbumEntities((prev) => (prev.length > 0 ? prev : list));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, searching, albumCards.length]);

  // Artists tab with nothing? Same dedicated-lane rule as albums: one extra
  // artist-entity search so "type the artist, find the artist" always works.
  const lastArtistQuery = useRef<string>("");
  useEffect(() => {
    const query = q.trim();
    if (tab !== "artists" || artistEntities.length > 0 || !query || searching) return;
    if (lastArtistQuery.current === query) return;
    lastArtistQuery.current = query;
    let alive = true;
    artistSearchApi(query)
      .then((list) => {
        if (alive && list.length > 0) setArtistEntities((prev) => (prev.length > 0 ? prev : list));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, searching, artistEntities.length]);

  // Dedupe artist entities by folded name (card artist + row artists can repeat)
  const artistCards = useMemo(() => {
    const seen = new Set<string>();
    const out: ApiArtistEntity[] = [];
    for (const a of artistEntities) {
      const k = foldKey(a.name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  }, [artistEntities]);

  // The top-result card opens its album through the same browse roundtrip —
  // synthesize an AlbumCard so openCard handles loading + error toasts.
  const topAlbumCard: AlbumCard | null =
    top?.kind === "album" && top.browseId
      ? { key: foldKey(top.name), name: top.name, artist: top.subtitle.split("•")[0]?.trim() || undefined, year: top.subtitle.match(/\b(19|20)\d{2}\b/)?.[0], thumb: top.thumb, browseId: top.browseId }
      : null;

  // The top-result card for a song/video plays immediately (the seed track first,
  // then its radio — the same semantics every row tap uses).
  const playTopSong = (entity: ApiTopEntity) => {
    if (!entity.videoId) return;
    const matched = results.find((t) => t.id === entity.videoId);
    const artistGuess = entity.subtitle.split("•")[0]?.trim() ?? "";
    const track: Track =
      matched ??
      apiTrackToTrack({
        videoId: entity.videoId,
        title: entity.name,
        artist: artistGuess,
        album: "",
        durationSec: 0,
        views: 0,
        tier: 1,
        thumb: entity.thumb,
      });
    playRadio(track, `${track.title} radio`);
    commitRecent(q);
  };

  const tabs: Array<"songs" | "albums" | "artists"> = ["songs", "albums", "artists"];

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

        {/* YouTube-style completions — tap one to run it */}
        {q.trim() && sugs.length > 0 && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" aria-label="Search suggestions">
            {sugs.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQ(s);
                  commitRecent(s);
                }}
                className="shrink-0 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-foreground/85 transition hover:bg-surface-3"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2" role="tablist" aria-label="Search result type">
          {tabs.map((t) => (
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
              {t === "songs" ? "Songs" : t === "albums" ? "Albums" : "Artists"}
            </button>
          ))}
          {searching && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" aria-label="Searching" />
          )}
        </div>
      </div>

      {q.trim() ? (
        // ── Results view ── (any result tap commits the current query to recents)
        <div onClickCapture={() => commitRecent()}>
        {albumOpen ? (
          <AlbumView id={albumOpen} onBack={() => setOpenAlbum(null)} />
        ) : searching && results.length === 0 && albumCards.length === 0 && artistCards.length === 0 && !top ? (
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
        ) : tab === "albums" ? (
          albumCards.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {albumCards.map((a) => (
                <button
                  key={a.key}
                  onClick={() => void openCard(a)}
                  disabled={!!openingKey}
                  className="group rounded-2xl p-3 text-left transition hover:bg-surface-2"
                  aria-label={`Open album ${a.name}`}
                >
                  <span className="relative block aspect-square w-full overflow-hidden rounded-xl shadow-lg shadow-black/30">
                    {a.thumb || a.cover ? (
                      <img src={(a.thumb ?? a.cover)!} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                    ) : (
                      <Cover from={a.colors![0]} to={a.colors![1]} seed={a.seed!} className="h-full w-full" />
                    )}
                    <span className="absolute inset-0 flex items-end justify-start bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100">
                      <span className="flex h-10 w-10 m-3 items-center justify-center rounded-full bg-[var(--accent)] shadow-xl">
                        {openingKey === a.key ? (
                          <Loader2 className="h-4 w-4 animate-spin text-black" />
                        ) : (
                          <Play className="h-4 w-4 fill-black text-black" />
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2.5 flex items-center gap-1.5">
                    <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Album</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-bold text-foreground">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.artist ? `${a.artist} · ` : ""}
                    {a.year ? `${a.year} · ` : ""}
                    {a.count !== undefined ? `${a.count} song${a.count === 1 ? "" : "s"}` : "Album"}
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
        ) : tab === "artists" ? (
          artistCards.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
              {artistCards.map((a) => (
                <button
                  key={a.browseId ?? a.name}
                  onClick={() => goToArtist(a.name)}
                  className="group flex flex-col items-center gap-2 text-center"
                  aria-label={`Open artist ${a.name}`}
                >
                  <span className="relative block aspect-square w-full overflow-hidden rounded-full border border-border bg-surface-2 shadow-lg shadow-black/20">
                    {a.thumb ? (
                      <img src={a.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.05]" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xl font-black text-muted-foreground">
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="w-full">
                    <span className="block truncate text-[13px] font-bold text-foreground">{a.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{a.subtitle || "Artist"}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <Mic2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-bold">No artists for “{q}”</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try the artist&apos;s full name —{" "}
                <button onClick={() => setTab("songs")} className="font-semibold text-[var(--accent)] underline underline-offset-2">
                  see songs
                </button>
              </p>
            </div>
          )
        ) : results.length > 0 || top ? (
          <div className="space-y-4">
            {/* YTM's top-result card — the artist/album/song YouTube Music itself pins
                above every result ("om" → the O.M: Operation Mole album card) */}
            {top && (
              <TopResultCard
                top={top}
                opening={!!openingKey && openingKey === topAlbumCard?.key}
                onOpenAlbum={topAlbumCard ? () => void openCard(topAlbumCard) : undefined}
                onPlay={() => playTopSong(top)}
                onOpenArtist={() => {
                  goToArtist(top.name);
                  commitRecent(q);
                }}
              />
            )}
            {results.length > 0 && (
              <section aria-label="Songs">
                {top && (
                  <h2 className="mb-2 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Songs</h2>
                )}
                <div className="space-y-0.5">
                  {results.map((t) => (
                    <TrackRow key={t.id} track={t} radio />
                  ))}
                </div>
              </section>
            )}
          </div>
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

// ── Top result card (YTM page model, batch18) ────────────────────────────────
// The one entity YouTube Music pins above every result list. Taps route by
// kind: album → the existing album page (one browse roundtrip), artist → the
// existing artist page, song/video → straight into playback (seed track + its
// radio, same as any row tap).

function TopResultCard({
  top,
  opening,
  onOpenAlbum,
  onPlay,
  onOpenArtist,
}: {
  top: ApiTopEntity;
  opening: boolean;
  onOpenAlbum?: () => void;
  onPlay: () => void;
  onOpenArtist: () => void;
}) {
  const kindLabel = top.kind === "artist" ? "Artist" : top.kind === "album" ? "Album" : top.kind === "song" ? "Song" : "Video";
  const Icon = top.kind === "artist" ? Mic2 : Disc3;
  const handleTap = () => {
    if (top.kind === "album") onOpenAlbum?.();
    else if (top.kind === "artist") onOpenArtist();
    else onPlay();
  };
  const interactive = top.kind === "artist" || top.kind === "song" || top.kind === "video" || (top.kind === "album" && !!onOpenAlbum);
  return (
    <section aria-label="Top result">
      <h2 className="mb-2 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Top result</h2>
      <button
        onClick={handleTap}
        disabled={!interactive || opening}
        className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-surface-2 p-3 text-left transition hover:bg-surface-3 disabled:opacity-60"
        aria-label={`Open ${kindLabel.toLowerCase()} ${top.name}`}
      >
        <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl shadow-lg shadow-black/30">
          {top.thumb ? (
            <img src={top.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-surface-3">
              {top.kind === "artist" ? (
                <span className="text-2xl font-black text-muted-foreground">{top.name.slice(0, 1).toUpperCase()}</span>
              ) : (
                <Icon className="h-6 w-6 text-muted-foreground" />
              )}
            </span>
          )}
          {(top.kind === "song" || top.kind === "video" || opening) && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-active:opacity-100">
              {opening ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Play className="h-6 w-6 fill-white text-white" />}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{kindLabel}</span>
          </span>
          <span className="mt-0.5 block truncate text-base font-extrabold text-foreground">{top.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{top.subtitle || kindLabel}</span>
          {top.kind === "album" && (
            <span className="mt-1 block text-[11px] font-semibold text-muted-foreground/80">Tap to open the full album</span>
          )}
        </span>
        {(top.kind === "song" || top.kind === "video") && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] shadow-xl transition group-hover:scale-105">
            <Play className="ml-0.5 h-5 w-5 fill-black text-black" />
          </span>
        )}
      </button>
    </section>
  );
}
