import { NextRequest, NextResponse } from "next/server";
import { radioFor } from "@/lib/yt/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/radio/<videoId> — the Autoplay layer for a seed track.
 * Mirrors YTM: track → RDAMVM<videoId> Mix → originals-only filtered queue.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await ctx.params;
  if (!/^[\w-]{11}$/.test(videoId)) return NextResponse.json({ error: "bad videoId" }, { status: 400 });

  try {
    const result = await radioFor(videoId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "radio failed", tracks: [] }, { status: 502 });
  }
}
