"use client";

import { useEffect, useState } from "react";
import { useCover } from "@/lib/covers";
import { extractPalette } from "@/lib/colorExtract";

type PalTrack = { id: string; title: string; artist: string; cover?: string } | null | undefined;

/**
 * Art-derived palette for the player surfaces: resolves the track's real album art
 * (mock ids go through the cover store) and extracts [top, deep, glow]. Returns
 * null while unresolved / on failure — callers fall back to the track's procedural
 * colors, so the wash is always beautiful and never breaks.
 */
export function useDominantPalette(track: PalTrack): [string, string, string] | null {
  const cover = useCover(track);
  const [pal, setPal] = useState<[string, string, string] | null>(null);

  // new track → reset immediately so a stale palette never bleeds across songs.
  // Render-time state adjustment (React's recommended pattern) — no effect needed.
  const id = track?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(id);
  if (id !== lastId) {
    setLastId(id);
    setPal(null);
  }

  useEffect(() => {
    let alive = true;
    if (!cover) return;
    extractPalette(cover).then((p) => {
      if (alive) setPal(p);
    });
    return () => {
      alive = false;
    };
  }, [cover]);

  return pal;
}
