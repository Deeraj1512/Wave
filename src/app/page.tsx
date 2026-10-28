"use client";

import { useState } from "react";
import { PlayerProvider, usePlayer } from "@/lib/player";
import { TopBar, Sidebar, BottomNav } from "@/components/Shell";
import { MiniPlayer, FullPlayer, QueuePanel } from "@/components/Player";
import { ShortcutsLayer } from "@/components/Shortcuts";
import { HomeScreen } from "@/components/screens/Home";
import { SearchScreen } from "@/components/screens/Search";
import { ExploreScreen } from "@/components/screens/Explore";
import { LibraryScreen } from "@/components/screens/Library";
import { LikedView, UserPlaylistView } from "@/components/screens/PlaylistView";
import type { Screen } from "@/lib/types";

export default function Page() {
  return (
    <PlayerProvider>
      <AppShell />
    </PlayerProvider>
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
  const { current } = usePlayer();

  const navigate = (s: Screen) => {
    setScreen(s);
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  };

  const searchFor = (q: string) => {
    setSearchSeed({ q, n: Date.now() });
    navigate({ name: "search" });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] text-foreground">
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
                />
              )}
              {screen.name === "playlist" &&
                (screen.id === "liked" ? <LikedView onBack={() => navigate({ name: "library" })} /> : <UserPlaylistView id={screen.id} onBack={() => navigate({ name: "library" })} />)}
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
      <ShortcutsLayer
        navigate={navigate}
        onToggleQueuePanel={() => setPanelOpen((v) => !v)}
        onCloseQueuePanel={() => setPanelOpen(false)}
      />
    </div>
  );
}
