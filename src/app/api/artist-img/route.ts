import { NextRequest, NextResponse } from "next/server";
import { artistPhoto } from "@/lib/yt/artistPhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real artist PHOTO (the face, not a song's album art). Used by the Radio
 * shelf, the onboarding artist grid and the Artist page hero. The heavy
 * resolution chain lives in yt/artistPhoto.ts (YTM artist avatar → Deezer).
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "name too long" }, { status: 400 });

  const url = await artistPhoto(name).catch(() => undefined);
  return NextResponse.json(
    { name, url: url ?? null },
    // the caller persists the resolved url in localStorage — CDN cache is just a bonus
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
  );
}
