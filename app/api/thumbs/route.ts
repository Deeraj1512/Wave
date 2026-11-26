import { NextRequest, NextResponse } from "next/server";
import { searchOriginals } from "@/lib/yt/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/thumbs — batch album-art resolver for the seed catalog.
 * Body: { items: [{ id, title, artist }] } → { covers: { [id]: url } }
 *
 * The mock seed tracks (t01–t26) carry no artwork; this looks each one up on YTM
 * (originals-only search, first tier-1 hit) and returns its album art. Results are
 * cached server-side forever (module scope) — the client additionally caches in
 * localStorage, so real lookups happen at most once per song, ever.
 */

interface ThumbItem {
  id: string;
  title: string;
  artist: string;
}

const cache = new Map<string, string | null>(); // queryKey -> cover url | null (null = looked up, none)

function keyOf(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.split(",")[0].toLowerCase().trim()}`;
}

async function lookupOne(item: ThumbItem): Promise<string | null> {
  const k = keyOf(item.title, item.artist);
  if (cache.has(k)) return cache.get(k)!;
  try {
    const artistFirst = item.artist.split(",")[0].trim();
    const res = await searchOriginals(`${item.title} ${artistFirst}`);
    const best = res.tracks.find((t) => t.thumb && t.durationSec >= 60) ?? res.tracks.find((t) => t.thumb);
    const cover = best?.thumb ?? null;
    cache.set(k, cover);
    return cover;
  } catch {
    return null; // don't cache failures — retried next session
  }
}

export async function POST(req: NextRequest) {
  let items: ThumbItem[] = [];
  try {
    const body = await req.json();
    items = Array.isArray(body?.items) ? body.items.slice(0, 40) : [];
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (items.length === 0) return NextResponse.json({ covers: {} });

  // chunked concurrency (6 at a time) — gentle on the InnerTube backend
  const covers: Record<string, string> = {};
  for (let i = 0; i < items.length; i += 6) {
    const chunk = items.slice(i, i + 6).filter((x) => x?.id && x?.title);
    const results = await Promise.all(
      chunk.map(async (item) => {
        const cover = await lookupOne(item);
        return cover ? ([item.id, cover] as const) : null;
      })
    );
    for (const r of results) if (r) covers[r[0]] = r[1];
  }

  return NextResponse.json({ covers });
}
