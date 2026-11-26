import { NextRequest, NextResponse } from "next/server";
import { resolveStream, getChainDebug } from "@/lib/yt/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostics: resolve a stream through Echo's client chain and report every hop. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await ctx.params;
  if (!/^[\w-]{11}$/.test(videoId)) return NextResponse.json({ error: "bad videoId" }, { status: 400 });

  const allowPreview = _req.nextUrl.searchParams.get("preview") === "1";
  const forceRefresh = _req.nextUrl.searchParams.get("refresh") === "1";

  const resolved = await resolveStream(videoId, { allowPreview, forceRefresh });
  return NextResponse.json({
    videoId,
    resolved: resolved
      ? {
          client: resolved.client,
          itag: resolved.itag,
          mimeType: resolved.mimeType,
          bitrate: resolved.bitrate,
          contentLength: resolved.contentLength,
          preview: resolved.preview,
          expiresInSeconds: Math.round((resolved.expiresAt - Date.now()) / 1000),
          urlHost: new URL(resolved.url).host,
        }
      : null,
    chain: getChainDebug(),
  });
}
