"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerProvider, usePlayer } from "@/lib/player";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { registerBackHandler, unregisterBackHandler } from "@/lib/backStack";
import { TopBar, Sidebar, BottomNav } from "@/components/Shell";
import { MiniPlayer, FullPlayer, QueuePanel } from "@/components/Player";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ShortcutsLayer } from "@/components/Shortcuts";
import { HomeScreen } from "@/components/screens/Home";
import { SearchScreen } from "@/components/screens/Search";
import { ExploreScreen } from "@/components/screens/Explore";
import { LibraryScreen } from "@/components/screens/Library";
import { LikedView, UserPlaylistView } from "@/components/screens/PlaylistView";
import { AlbumView } from "@/components/screens/AlbumView";
import { ArtistView } from "@/components/screens/ArtistView";
import { DownloadsView } from "@/components/screens/DownloadsView";
import { Onboarding, useOnboardingGate } from "@/components/Onboarding";
import { OPEN_ALBUM_EVENT } from "@/lib/goToAlbum";
import { OPEN_ARTIST_EVENT } from "@/lib/goToArtist";
import type { Screen } from "@/lib/types";

export default function Page() {
  return (
    <ErrorBoundary>
      <PlayerProvider>
        <AppShell />
      </PlayerProvider>
    </ErrorBoundary>
  );
}

/**
 * YTM web chrome, verbatim:
 *   top bar (brand · search pill) — YTM
 *   left rail (Home / Explore / Library + Liked) — YTM nav
 *   right "Up next" panel (Q) — YTM's desktop queue
 *   three-zone player bar — YTM layout
 */
function AppShell() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [searchSeed, setSearchSeed] = useState<{ q: string; n: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // "Go to album" from the FULL PLAYER opens the album as a separate page ON
  // TOP of the player (z-[55] overlay) — the player stays open underneath, so
  // closing the album returns straight back to it (the user's ask). From song
  // rows the album is a normal screen instead.
  const [albumOverPlayer, setAlbumOverPlayer] = useState<string | null>(null);
  const [artistOverPlayer, setArtistOverPlayer] = useState<string | null>(null);
  const { current, expanded } = usePlayer();

  // ── screen history ────────────────────────────────────────────────────────
  // navigate() pushes the page you leave onto the stack; goBack() pops it.
  // This is what makes Back REAL everywhere: the album page's arrow, the
  // playlist arrows, AND the Android hardware back button all walk the same
  // history instead of the app just minimizing.
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  });
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  });
  const historyRef = useRef<Screen[]>([]);

  const scrollTop = () => document.getElementById("main-scroll")?.scrollTo({ top: 0 });

  const sameScreen = (a: Screen | null, b: Screen) =>
    !!a && a.name === b.name && (("id" in a ? a.id : undefined) === ("id" in b ? b.id : undefined));

  const navigate = (s: Screen) => {
    // re-selecting the page you're already on (tab re-tap, a new search seed
    // while on search) must not duplicate history entries
    if (!sameScreen(screenRef.current, s)) {
      historyRef.current.push(screenRef.current);
      if (historyRef.current.length > 25) historyRef.current.shift();
      setScreen(s);
    }
    scrollTop();
  };

  const goBack = () => {
    const prev = historyRef.current.pop();
    setScreen(prev ?? { name: "home" });
    scrollTop();
  };

  // lowest layer: hardware back walks the screen history; with no history left
  // the press falls through and Android minimizes the app (music keeps playing)
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });
  useEffect(() => {
    registerBackHandler("screens", 10, () => {
      if (historyRef.current.length === 0) return false;
      goBackRef.current();
      return true;
    });
    return () => unregisterBackHandler("screens");
  }, []);

  // ── "Go to album" (from the player menu / song rows — anywhere) ───────────
  // Full player expanded → the album opens ON TOP of the player as its own
  // page (back arrow closes it and the player is right there again). Otherwise
  // it's a regular screen change, and Back returns to the page it came from.
  const albumScrollRef = useRef<HTMLDivElement | null>(null);
  const artistScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onOpenAlbum = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      if (expandedRef.current) {
        setArtistOverPlayer(null); // the overlays are exclusive — one page on top at a time
        setAlbumOverPlayer(id);
        scrollTop();
        return;
      }
      navigate({ name: "album", id });
    };
    window.addEventListener(OPEN_ALBUM_EVENT, onOpenAlbum);
    return () => window.removeEventListener(OPEN_ALBUM_EVENT, onOpenAlbum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── "Open artist" (Radio shelf — anywhere): the artist page is a normal
  //    screen on the history stack, so its back arrow AND the Android
  //    hardware Back both return where you came from. ──
  useEffect(() => {
    const onOpenArtist = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (!name) return;
      if (expandedRef.current) {
        // from the FULL PLAYER: the artist page slides up ON TOP of the
        // player (same as "Go to album") — closing it returns straight back
        setAlbumOverPlayer(null); // the overlays are exclusive — one page on top at a time
        setArtistOverPlayer(name);
        scrollTop();
        return;
      }
      navigate({ name: "artist", id: name });
    };
    window.addEventListener(OPEN_ARTIST_EVENT, onOpenArtist);
    return () => window.removeEventListener(OPEN_ARTIST_EVENT, onOpenArtist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // top layer: hardware back closes the album-over-player overlay first —
  // the full player (still open underneath) comes straight back
  useEffect(() => {
    if (!albumOverPlayer) return;
    registerBackHandler("album-overlay", 30, () => {
      setAlbumOverPlayer(null);
      return true;
    });
    albumScrollRef.current?.scrollTo({ top: 0 });
    return () => unregisterBackHandler("album-overlay");
  }, [albumOverPlayer]);

  // same for the artist-over-player overlay
  useEffect(() => {
    if (!artistOverPlayer) return;
    registerBackHandler("artist-overlay", 30, () => {
      setArtistOverPlayer(null);
      return true;
    });
    artistScrollRef.current?.scrollTo({ top: 0 });
    return () => unregisterBackHandler("artist-overlay");
  }, [artistOverPlayer]);

  const searchFor = (q: string) => {
    setSearchSeed({ q, n: Date.now() });
    navigate({ name: "search" });
  };

  // ── onboarding (batch 2): first run → the taste flow; Library → "Your taste"
  //    re-opens it prefilled via the wave:open-profile event ──
  const [onboardingOpen, setOnboardingOpen] = useOnboardingGate();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] text-foreground">
      {onboardingOpen && <Onboarding onDone={() => setOnboardingOpen(false)} />}
      <TopBar screen={screen} navigate={navigate} />

      <div className="flex min-h-0 flex-1">
        <Sidebar screen={screen} navigate={navigate} />

        <main className="relative min-w-0 flex-1">
          <div id="main-scroll" className="h-full overflow-y-auto px-4 pt-5 sm:px-6">
            <div className="mx-auto max-w-6xl pb-[calc(env(safe-area-inset-bottom)+175px)] md:pb-32">
              {screen.name === "home" && <HomeScreen />}
              {screen.name === "explore" && <ExploreScreen onSearch={searchFor} />}
              {screen.name === "search" && <SearchScreen initialQuery={searchSeed?.q} seedKey={searchSeed?.n} />}
              {screen.name === "library" && (
                <LibraryScreen
                  onOpenLiked={() => navigate({ name: "playlist", id: "liked" })}
                  onOpenPlaylist={(id) => navigate({ name: "playlist", id })}
                  onOpenDownloads={() => navigate({ name: "downloads" })}
                />
              )}
              {screen.name === "playlist" &&
                (screen.id === "liked" ? <LikedView onBack={goBack} /> : <UserPlaylistView id={screen.id} onBack={goBack} />)}
              {screen.name === "album" && <AlbumView id={screen.id} onBack={goBack} />}
              {screen.name === "artist" && <ArtistView name={screen.id} onBack={goBack} />}
              {screen.name === "downloads" && <DownloadsView onBack={goBack} />}
            </div>
          </div>
        </main>

        {/* YTM's desktop queue — right panel beside the content, above the player bar */}
        {panelOpen && current && (
          <aside className="hidden w-[400px] shrink-0 border-l border-border md:block" aria-label="Up next queue">
            <QueuePanel current={current} onClose={() => setPanelOpen(false)} />
          </aside>
        )}
      </div>

      {/* bottom stack: player bar above the mobile nav */}
      <div className="relative z-40 shrink-0">
        {current && <MiniPlayer onToggleQueuePanel={() => setPanelOpen((v) => !v)} queuePanelOpen={panelOpen} />}
        <BottomNav screen={screen} navigate={navigate} />
      </div>

      <FullPlayer />

      {/* "Go to album" opened from the full player — a separate page OVER the
          player (z-55, above the player's z-50, under the ⋮ sheets at z-70).
          Its back arrow closes it and the player is exactly where it was;
          hardware back does the same via the album-overlay back handler. */}
      <AnimatePresence>
        {albumOverPlayer && (
          <motion.div
            key="album-over-player"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-[55] flex flex-col overflow-hidden bg-[var(--bg)] text-foreground"
            role="dialog"
            aria-label="Album"
          >
            <div ref={albumScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 sm:px-6">
              <div className="mx-auto max-w-6xl pb-[calc(env(safe-area-inset-bottom)+40px)]">
                <AlbumView id={albumOverPlayer} onBack={() => setAlbumOverPlayer(null)} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Go to artist" opened from the full player — mirrors the album
          overlay: a separate page OVER the player (z-55); its back arrow
          (or hardware back) closes it and the player is exactly where it
          was. */}
      <AnimatePresence>
        {artistOverPlayer && (
          <motion.div
            key="artist-over-player"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-[55] flex flex-col overflow-hidden bg-[var(--bg)] text-foreground"
            role="dialog"
            aria-label="Artist"
          >
            <div ref={artistScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 sm:px-6">
              <div className="mx-auto max-w-6xl pb-[calc(env(safe-area-inset-bottom)+40px)]">
                <ArtistView name={artistOverPlayer} onBack={() => setArtistOverPlayer(null)} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PullToRefresh />
      <ShortcutsLayer
        navigate={navigate}
        onToggleQueuePanel={() => setPanelOpen((v) => !v)}
        onCloseQueuePanel={() => setPanelOpen(false)}
      />
    </div>
  );
}
