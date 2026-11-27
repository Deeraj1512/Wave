import { NextRequest, NextResponse } from "next/server";
import { searchArtistsOnly } from "@/lib/yt/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ARTIST entities for the search screen's Artists tab (batch18 — YTM page
 * model). One unfiltered YTM search POST server-side; the APK runs the same
 * chain in-process (api.ts IS_NATIVE branch), so this route is web-only.
 */
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ ...(hit.data as object), cached: true });
  }

  try {
    const artists = await searchArtistsOnly(q);
    cache.set(q.toLowerCase(), { at: Date.now(), data: { artists } });
    return NextResponse.json({ artists });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "artists failed" }, { status: 502 });
  }
}
