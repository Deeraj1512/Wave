"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Compass, Heart, Home, Library, Music, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/player";
import { createUserPlaylist, getUserPlaylists, subscribePlaylists } from "@/lib/playlists";
import { useToast } from "@/hooks/use-toast";
import type { Screen } from "@/lib/types";

const NAV_ITEMS = [
  { key: "home" as const, label: "Home", icon: Home },
  { key: "explore" as const, label: "Explore", icon: Compass },
  { key: "library" as const, label: "Library", icon: Library },
];

/**
 * YTM's top chrome: wordmark left, a rounded search pill (desktop), mobile search
 * entry right. No utility icons — keyboard help stays on "?", Library lives in the rail.
 */
export function TopBar({ screen, navigate }: { screen: Screen; navigate: (s: Screen) => void }) {
  const onSearchScreen = screen.name === "search";
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 bg-[var(--bg)] px-4 sm:px-5">
      {/* brand — mark + wordmark */}
      <button onClick={() => navigate({ name: "home" })} className="flex shrink-0 items-center gap-2.5" aria-label="Wave home">
        <Image src="/wave-mark.png?v=3" alt="" width={28} height={28} priority className="h-7 w-7 rounded-[9px]" aria-hidden />
        <span className="text-xl font-medium tracking-tight text-foreground">
          Wave<span className="text-[#ff0000]">.</span>
        </span>
      </button>

      {/* search pill — YTM's signature top bar (desktop) */}
      {!onSearchScreen && (
        <button
          onClick={() => navigate({ name: "search" })}
          className="mx-auto hidden h-10 w-full max-w-[540px] items-center gap-3 rounded-full bg-surface-2 px-4 text-left transition hover:bg-surface-3 md:flex"
          aria-label="Search songs, albums, artists"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm text-muted-foreground">Search songs, albums, artists…</span>
        </button>
      )}
      {onSearchScreen && <div className="mx-auto hidden flex-1 md:block" />}

      <div className={cn("ml-auto flex shrink-0 items-center gap-1.5", !onSearchScreen && "md:ml-0")}>
        {/* mobile search entry — YTM keeps search in the top bar on phones */}
        {!onSearchScreen && (
          <button
            onClick={() => navigate({ name: "search" })}
            aria-label="Search"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface-2 hover:text-foreground md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>
        )}
      </div>
    </header>
  );
}

export function Sidebar({ screen, navigate }: { screen: Screen; navigate: (s: Screen) => void }) {
  const active = screen.name === "playlist" ? "library" : screen.name;
  const { likedIds } = usePlayer();
  const { toast } = useToast();

  // user playlists — external store, re-derived on every mutation
  const [plV, setPlV] = useState(0);
  useEffect(() => subscribePlaylists(() => setPlV((v) => v + 1)), []);
  const playlists = useMemo(() => {
    void plV;
    return getUserPlaylists();
  }, [plV]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const create = () => {
    const pl = createUserPlaylist(newName);
    if (!pl) return;
    setNewName("");
    setCreating(false);
    toast({ title: "Playlist created", description: pl.name, duration: 2500 });
  };

  const rowCls = (on: boolean) =>
    cn(
      "flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
      on ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
    );

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col overflow-hidden border-r border-border bg-surface/60 md:flex" aria-label="Primary">
      {/* Nav — YTM rail grammar: white bold on active, quiet otherwise */}
      <nav className="space-y-1 px-3 pt-2">
        {NAV_ITEMS.map((it) => (
          <button
            key={it.key}
            onClick={() => navigate({ name: it.key })}
            aria-current={active === it.key ? "page" : undefined}
            className={rowCls(active === it.key)}
          >
            <it.icon className={cn("h-5 w-5", active === it.key && "text-foreground")} />
            {it.label}
          </button>
        ))}
      </nav>

      <div className="mx-5 my-4 h-px bg-border" />

      {/* Liked songs — the one collection that is always truly yours */}
      <div className="px-3">
        <button
          onClick={() => navigate({ name: "playlist", id: "liked" })}
          aria-current={screen.name === "playlist" && screen.id === "liked" ? "page" : undefined}
          className={rowCls(screen.name === "playlist" && screen.id === "liked")}
        >
          <Heart
            className={cn(
              "h-5 w-5",
              screen.name === "playlist" && screen.id === "liked" ? "fill-[var(--accent)] text-[var(--accent)]" : "text-muted-foreground"
            )}
          />
          <span className="min-w-0 flex-1 truncate text-left">Liked songs</span>
          {likedIds.size > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{likedIds.size}</span>}
        </button>
      </div>

      {/* Your playlists — create here, open into the collection view */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
        <button
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className={rowCls(false)}
        >
          <span className="flex h-5 w-5 items-center justify-center">
            <Plus className="h-5 w-5" />
          </span>
          Create playlist
        </button>
        {creating && (
          <div className="px-1.5 pb-1.5 pt-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) create();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              placeholder="Playlist name"
              aria-label="New playlist name"
              maxLength={80}
              className="h-9 w-full rounded-lg bg-surface-2 px-3 text-sm outline-none ring-white/10 placeholder:text-muted-foreground focus:ring-1"
            />
          </div>
        )}
        <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pb-2">
          {playlists.map((pl) => {
            const on = screen.name === "playlist" && screen.id === pl.id;
            return (
              <button
                key={pl.id}
                onClick={() => navigate({ name: "playlist", id: pl.id })}
                aria-current={on ? "page" : undefined}
                className={rowCls(on)}
              >
                <Music className={cn("h-5 w-5 shrink-0", on ? "text-[var(--accent)]" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 truncate text-left">{pl.name}</span>
                {pl.tracks.length > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{pl.tracks.length}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function BottomNav({ screen, navigate }: { screen: Screen; navigate: (s: Screen) => void }) {
  const active = screen.name === "playlist" ? "library" : screen.name;

  return (
    <nav className="flex items-stretch border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl md:hidden" aria-label="Primary mobile">
      {NAV_ITEMS.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            onClick={() => navigate({ name: it.key })}
            aria-current={isActive ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-1 py-2.5"
          >
            <it.icon className={cn("h-5 w-5", isActive ? "text-[var(--accent)]" : "text-muted-foreground")} />
            <span className={cn("text-[10px] font-bold", isActive ? "text-foreground" : "text-muted-foreground")}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

