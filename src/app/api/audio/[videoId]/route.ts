import { NextRequest, NextResponse } from "next/server";
import { resolveStreamSmart, invalidateStream } from "@/lib/yt/resolve";
import type { ResolvedStream } from "@/lib/yt/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audio proxy — port of our proven /api/audio architecture:
 * googlevideo URLs are IP-bound to the minter, so the SERVER fetches and re-serves. Any device
 * can then play through this endpoint. Range/seek passthrough, and on googlevideo 403 we
 * invalidate + re-resolve once and retry (Echo's onRefused → exclude → next client).
 *
 * `?title=&artist=` enables the sibling fallback: when the requested video is bot-gated
 * (common for art tracks from datacenter IPs), the same song's official music video is
 * resolved instead — identical audio, different upload.
 */

function userAgentFor(clientName: string): string {
  // The minting client's UA is what googlevideo expects on the fetch (proven in our spike).
  switch (clientName) {
    case "VISIONOS":
      return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    case "ANDROID_VR":
      return "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
    case "IOS":
      return "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)";
    case "TVHTML5":
      return "Mozilla/5.0(SMART-TV; Linux; Tizen 4.0.0.2) AppleWebkit/605.1.15 (KHTML, like Gecko) SamsungBrowser/9.2 TV Safari/605.1.15";
    default:
      return "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  }
}

async function pipe(resolved: ResolvedStream, range?: string | null) {
  const h: Record<string, string> = { "User-Agent": userAgentFor(resolved.client) };
  if (range) h["Range"] = range;
  return fetch(resolved.url, { headers: h, signal: AbortSignal.timeout(30000) });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await ctx.params;
  if (!/^[\w-]{11}$/.test(videoId)) return NextResponse.json({ error: "bad videoId" }, { status: 400 });

  const range = req.headers.get("range");
  const title = req.nextUrl.searchParams.get("title") ?? undefined;
  const artist = req.nextUrl.searchParams.get("artist") ?? undefined;
  const durRaw = req.nextUrl.searchParams.get("dur");
  const durationSec = durRaw ? Number(durRaw) : undefined;

  let resolved = await resolveStreamSmart(videoId, { title, artist, durationSec });
  if (!resolved) {
    return NextResponse.json({ error: "no stream available", gated: true }, { status: 502 });
  }

  let upstream = await pipe(resolved, range);

  // 403 → URL may have expired or client refused; invalidate + re-resolve once, then retry.
  if (upstream.status === 403 || upstream.status === 410) {
    invalidateStream(videoId);
    const retry = await resolveStreamSmart(videoId, { title, artist, durationSec });
    if (!retry) return NextResponse.json({ error: "re-resolve failed" }, { status: 502 });
    resolved = retry;
    upstream = await pipe(retry, range);
    if (upstream.status === 403 || upstream.status === 410) {
      return NextResponse.json({ error: "googlevideo refused after re-resolve" }, { status: 502 });
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", resolved.mimeType.includes("mp4") ? "audio/mp4" : resolved.mimeType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");
  const cr = upstream.headers.get("content-range");
  if (cr) headers.set("Content-Range", cr);
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("Content-Length", cl);
  headers.set("X-Dhun-Client", resolved.client);
  if (resolved.viaSibling) headers.set("X-Dhun-Sibling", "1");

  return new Response(upstream.body, { status: upstream.status, headers });
}
