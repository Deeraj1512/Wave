"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Clock, Disc3, Loader2, Music2, Play, Search, WifiOff, X } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { Cover } from "../Cover";
import { GENRE_TILES } from "@/lib/data";
import { searchFullApi, albumSearchApi, albumBrowseApi, suggestApi, type ApiAlbum } from "@/lib/api";
import { groupAlbums, registerAlbum } from "@/lib/albums";
import { useToast } from "@/hooks/use-toast";
import type { Track } from "@/lib/types";
import {
  spotifyAvailable,
  spotifyHitToTrack,
  spotifyPicks,
  spotifyRelated,
  spotifySearch,
} from "@/lib/spotify/bridge";
import type { SpAlbumLite, SpArtistLite, SpTrackHit } from "@/lib/spotify/types";
import { goToArtist } from "@/lib/goToArtist";
import { recentPlays, topArtists } from "@/lib/history";
import { rankedTasteLangs } from "@/lib/profile";
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

export function SearchScreen({ initialQuery, seedKey }: { initialQuery?: string; seedKey?: number }) {
  const { toast } = useToast();
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
  // Result tabs — "Songs" is the classic track list, "Albums" narrows to album
  // cards, "Spotify" switches the whole view to the Spotify bridge (declared
  // here because both search effects read it in their deps).
  const [results, setResults] = useState<Track[]>([]);
  const [albumEntities, setAlbumEntities] = useState<ApiAlbum[]>([]);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<{ q: string } | null>(null);
  const [tab, setTab] = useState<"songs" | "albums" | "spotify">("songs");
  const switchTab = (t: "songs" | "albums" | "spotify") => {
    setTab(t);
    if (openAlbum) setOpenAlbum(null); // leaving the album page via the tabs
  };
  useEffect(() => {
    const query = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (!query || tab === "spotify") {
        setResults([]);
        setAlbumEntities([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchFullApi(query, ctrl.signal)
        .then(({ tracks, albums }) => {
          setResults(tracks);
          setAlbumEntities(albums);
          setFailure(null);
          setSearching(false);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setResults([]);
          setAlbumEntities([]);
          setFailure({ q: query });
          setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab]);

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

  // ── Spotify mode (Phase 1) — the third tab. Everything Spotify happens on
  //    the server bridge (the client secret never leaves it); tracks arrive
  //    already matched to playable videoIds, so playback/queue/radio run the
  //    EXISTING pipeline. With no bridge configured the tab simply never
  //    appears — zero behavior change for a pure-YTM deployment.
  const [spOk, setSpOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    spotifyAvailable()
      .then((ok) => alive && setSpOk(ok))
      .catch(() => alive && setSpOk(false));
    return () => {
      alive = false;
    };
  }, []);

  const [spHits, setSpHits] = useState<SpTrackHit[]>([]);
  const [spArtists, setSpArtists] = useState<SpArtistLite[]>([]);
  const [spAlbums, setSpAlbums] = useState<SpAlbumLite[]>([]);
  const [spLoading, setSpLoading] = useState(false);
  const [spError, setSpError] = useState(false);
  const [spOpening, setSpOpening] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "spotify") return;
    const query = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (!query) {
        setSpHits([]);
        setSpArtists([]);
        setSpAlbums([]);
        setSpLoading(false);
        setSpError(false);
        return;
      }
      setSpLoading(true);
      spotifySearch(query, ctrl.signal)
        .then((res) => {
          setSpHits(res.tracks);
          setSpArtists(res.artists.slice(0, 8));
          setSpAlbums(res.albums.slice(0, 8));
          setSpError(false);
          setSpLoading(false);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setSpHits([]);
          setSpArtists([]);
          setSpAlbums([]);
          setSpError(true);
          setSpLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, tab]);

  // Spotify albums don't get their own page family — an album tap matches the
  // Spotify album to its REAL YouTube album (entity search + /browse, the same
  // ladder openCard uses) and opens the existing album page with its full
  // official tracklist. One browse roundtrip — real YTM credits and art.
  const foldKey = (s: string): string =>
    (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const openSpAlbum = async (a: SpAlbumLite) => {
    if (spOpening || openingKey) return;
    setSpOpening(a.id);
    try {
      const entities = await albumSearchApi(a.title, a.artist || undefined);
      let page: Awaited<ReturnType<typeof albumBrowseApi>> = null;
      for (const e of entities.slice(0, 3)) {
        const et = foldKey(e.title);
        const at = foldKey(a.title);
        if (
          !et ||
          !at ||
          !(et === at || (et.length >= 4 && et.includes(at)) || (at.length >= 4 && at.includes(et)))
        )
          continue;
        const p = await albumBrowseApi(e.browseId).catch(() => null);
        if (p && p.tracks.length > 0) {
          page = p;
          break;
        }
      }
      if (!page) throw new Error("no ytm album");
      const pageKey = foldKey(page.album.title);
      if (!pageKey) throw new Error("bad key");
      registerAlbum(pageKey, page.tracks);
      const spKey = foldKey(a.title);
      if (spKey && spKey !== pageKey) registerAlbum(spKey, page.tracks);
      setOpenAlbum({ key: pageKey, q });
      commitRecent(q);
    } catch {
      toast({
        title: "Couldn't open this album",
        description: "No YouTube album matched this Spotify album",
        duration: 3000,
      });
    } finally {
      setSpOpening(null);
    }
  };

  // Pinned album on the Songs tab — when the query IS an album name and an
  // entity matched, the album surfaces FIRST (like YTM's top-result card).
  const pinned: ApiAlbum | undefined = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 3) return undefined;
    return albumEntities.find((a) => {
      const n = a.title.toLowerCase();
      return n === query || (n.length >= 4 && n.includes(query)) || (query.length >= 4 && query.includes(n));
    });
  }, [albumEntities, q]);

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

  // The tab row always renders — the Spotify chip must be discoverable on the
  // empty browse view too (that's where its picks shelf lives).
  const tabs: Array<"songs" | "albums" | "spotify"> = spOk ? ["songs", "albums", "spotify"] : ["songs", "albums"];
  const onSpotify = tab === "spotify";

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
              {t === "songs" ? "Songs" : t === "albums" ? "Albums" : "Spotify"}
            </button>
          ))}
          {(onSpotify ? spLoading : searching) && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" aria-label="Searching" />
          )}
        </div>
      </div>

      {q.trim() ? (
        // ── Results view ── (any result tap commits the current query to recents)
        <div onClickCapture={() => commitRecent()}>
        {albumOpen ? (
          <AlbumView id={albumOpen} onBack={() => setOpenAlbum(null)} />
        ) : onSpotify ? (
          <SpotifyResults
            hits={spHits}
            artists={spArtists}
            albums={spAlbums}
            loading={spLoading}
            failed={spError}
            query={q.trim()}
            opening={spOpening}
            onOpenAlbum={(a) => void openSpAlbum(a)}
          />
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
        ) : results.length > 0 || albumCards.length > 0 ? (
          tab === "albums" ? (
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
          ) : (
            <div className="space-y-4">
              {/* pinned album — the query named an album, show it first */}
              {pinned && !albumOpen && (
                <button
                  onClick={() => void openCard({ key: pinned.title.toLowerCase(), name: pinned.title, artist: pinned.artist, thumb: pinned.thumb, browseId: pinned.browseId })}
                  disabled={!!openingKey}
                  className="flex w-full items-center gap-4 rounded-2xl border border-border bg-surface-2 p-3 text-left transition hover:bg-surface-3"
                >
                  <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                    {pinned.thumb ? (
                      <img src={pinned.thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-surface-3">
                        <Disc3 className="h-6 w-6 text-muted-foreground" />
                      </span>
                    )}
                    {openingKey === pinned.title.toLowerCase() && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Disc3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Album</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-bold text-foreground">{pinned.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {pinned.artist ? `${pinned.artist} · ` : ""}Tap to open the full album
                    </span>
                  </span>
                </button>
              )}
              <div className="space-y-0.5">
                {results.map((t) => (
                  <TrackRow key={t.id} track={t} radio />
                ))}
              </div>
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
      ) : onSpotify ? (
        // ── Spotify picks (Phase 3) — the empty-state shelf of the Spotify tab ──
        <SpotifyPicksPanel active />
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

// ── Spotify results view (Phase 1) ───────────────────────────────────────────
// Pure presentation over bridge data — hooks stay in SearchScreen. Artist taps
// open the EXISTING per-artist page (goToArtist); album taps resolve to the
// existing YTM album page via openSpAlbum; matched songs are first-class
// Tracks (queue, radio, likes, history all work). Unmatched tracks render
// dimmed and non-interactive — a wrong videoId is worse than an honest
// "no YouTube match".

function SpotifyResults({
  hits,
  artists,
  albums,
  loading,
  failed,
  query,
  opening,
  onOpenAlbum,
}: {
  hits: SpTrackHit[];
  artists: SpArtistLite[];
  albums: SpAlbumLite[];
  loading: boolean;
  failed: boolean;
  query: string;
  opening: string | null;
  onOpenAlbum: (a: SpAlbumLite) => void;
}) {
  if (failed) {
    return (
      <div className="py-16 text-center">
        <WifiOff className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-4 text-lg font-bold">Couldn&apos;t reach Spotify</p>
        <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again — your query is still in the box.</p>
      </div>
    );
  }
  const empty = hits.length === 0 && artists.length === 0 && albums.length === 0;
  if (empty && !loading) {
    return (
      <div className="py-16 text-center">
        <Search className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-4 text-lg font-bold">No Spotify results for &ldquo;{query}&rdquo;</p>
        <p className="mt-1 text-sm text-muted-foreground">Try the Songs tab — it searches YouTube Music too.</p>
      </div>
    );
  }
  if (empty) {
    return (
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
    );
  }
  return (
    <div className="space-y-7">
      {artists.length > 0 && (
        <section aria-label="Spotify artists">
          <h2 className="mb-3 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Artists</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
            {artists.map((a) => (
              <button
                key={a.id}
                onClick={() => goToArtist(a.name)}
                className="flex w-20 shrink-0 flex-col items-center gap-2"
                aria-label={`Open artist ${a.name}`}
              >
                <span className="h-20 w-20 overflow-hidden rounded-full border border-border bg-surface-2">
                  {a.image ? (
                    <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-lg font-black text-muted-foreground">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-xs font-semibold text-foreground">{a.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section aria-label="Spotify albums">
          <h2 className="mb-3 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Albums</h2>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
            {albums.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenAlbum(a)}
                disabled={!!opening}
                className="w-36 shrink-0 rounded-2xl p-2 text-left transition hover:bg-surface-2"
                aria-label={`Open album ${a.title}`}
              >
                <span className="relative block aspect-square w-full overflow-hidden rounded-xl shadow-lg shadow-black/30">
                  {a.image ? (
                    <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-surface-3">
                      <Disc3 className="h-6 w-6 text-muted-foreground" />
                    </span>
                  )}
                  {opening === a.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </span>
                  )}
                </span>
                <span className="mt-2 block truncate text-[13px] font-bold text-foreground">{a.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[a.artist, a.year].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {hits.length > 0 && (
        <section aria-label="Spotify songs">
          {(artists.length > 0 || albums.length > 0) && (
            <h2 className="mb-2 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Songs</h2>
          )}
          <div className="space-y-0.5">
            {hits.map((h) =>
              h.videoId ? (
                <TrackRow key={h.spotifyId} track={spotifyHitToTrack(h)} radio />
              ) : (
                <div key={`sp-${h.spotifyId}`} className="flex items-center gap-4 rounded-xl px-3 py-2 opacity-50">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-3">
                    {h.image ? <img src={h.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{h.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {h.artist ? `${h.artist} · ` : ""}no YouTube match
                    </span>
                  </span>
                </div>
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Spotify picks (Phase 3) ──────────────────────────────────────────────────
// The empty-state shelf of the Spotify tab: recommendations seeded by what the
// listener actually plays — top artists from listening history + taste
// languages as genre seeds — plus "fans also like" artist chips from Spotify's
// related-artists (hidden automatically while the app is quota-gated; dev-mode
// apps don't have that endpoint yet). Picks themselves always render: the
// bridge falls back to popularity-ranked search from the same seeds when
// /recommendations is gated, so the shelf works in dev mode and upgrades to
// real recommendations when Extended Quota lands. Cached 10 min per session —
// tab switches stay instant.

interface PicksData {
  anchor?: string;
  rows: SpTrackHit[];
  related: SpArtistLite[];
}

let picksCache: { at: number; data: PicksData } | null = null;

function SpotifyPicksPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<PicksData | null>(() =>
    picksCache && Date.now() - picksCache.at < 10 * 60 * 1000 ? picksCache.data : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || data || loading) return;
    let alive = true;
    setLoading(true);
    (async () => {
      let seedArtists: string[] = [];
      let seedGenres: string[] = [];
      try {
        seedArtists = topArtists(6).slice(0, 3);
      } catch {
        /* fresh install */
      }
      try {
        const counts = new Map<string, number>();
        for (const p of recentPlays(60)) {
          if (p.lang) counts.set(p.lang, (counts.get(p.lang) ?? 0) + Math.max(1, p.n ?? 1));
        }
        seedGenres = rankedTasteLangs(counts)
          .slice(0, 3)
          .map((l) => l.toLowerCase());
      } catch {
        /* no profile yet */
      }
      try {
        const picks = await spotifyPicks(seedArtists, seedGenres, 15);
        let related: SpArtistLite[] = [];
        if (picks.available && seedArtists[0]) {
          try {
            const r = await spotifyRelated(seedArtists[0]);
            if (r.available) related = r.artists.slice(0, 8);
          } catch {
            /* related is optional */
          }
        }
        const out: PicksData = {
          anchor: seedArtists[0],
          rows: picks.available ? picks.tracks : [],
          related,
        };
        if (alive) {
          setData(out);
          picksCache = { at: Date.now(), data: out };
        }
      } catch {
        if (alive) setData({ rows: [], related: [] });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, data, loading]);

  if (!active) return null;
  if (loading && !data) {
    return (
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
    );
  }
  if (!data || data.rows.length === 0) return null;

  return (
    <div className="space-y-7">
      {data.related.length > 0 && (
        <section aria-label="Fans also like">
          <h2 className="mb-3 px-1 text-sm font-extrabold uppercase tracking-wider text-muted-foreground">
            {data.anchor ? `Fans of ${data.anchor} also like` : "Fans also like"}
          </h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
            {data.related.map((a) => (
              <button
                key={a.id}
                onClick={() => goToArtist(a.name)}
                className="flex w-20 shrink-0 flex-col items-center gap-2"
                aria-label={`Open artist ${a.name}`}
              >
                <span className="h-20 w-20 overflow-hidden rounded-full border border-border bg-surface-2">
                  {a.image ? (
                    <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-lg font-black text-muted-foreground">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-xs font-semibold text-foreground">{a.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Spotify picks">
        <h2 className="mb-2 flex items-center gap-2 px-1 text-lg font-extrabold tracking-tight">
          <Music2 className="h-4 w-4 text-muted-foreground" /> Spotify picks
        </h2>
        <div className="space-y-0.5">
          {data.rows.map((h) =>
            h.videoId ? (
              <TrackRow key={h.spotifyId} track={spotifyHitToTrack(h)} radio />
            ) : (
              <div key={`sp-${h.spotifyId}`} className="flex items-center gap-4 rounded-xl px-3 py-2 opacity-50">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-3">
                  {h.image ? <img src={h.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{h.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {h.artist ? `${h.artist} · ` : ""}no YouTube match
                  </span>
                </span>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
