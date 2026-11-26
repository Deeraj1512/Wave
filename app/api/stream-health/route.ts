import { NextResponse } from "next/server";
import { resolveStream, breakerStatus } from "@/lib/yt/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time capability probe: can THIS server mint googlevideo URLs (residential IP → "direct")
 * or is /player bot-gated (datacenter IP → "embed")? The client asks once at app load and skips
 * the doomed direct attempt entirely when the answer is embed.
 *
 * Cheap by design: a single resolve attempt for a well-known videoId, result cached 10 minutes
 * server-side (module scope). When the breaker is open we answer embed immediately.
 */

const PROBE_VIDEO_ID = "jNQXAC9IVRw"; // "Me at the zoo" — the most stable video on YouTube
const TTL = 10 * 60 * 1000;

let cached: { engine: "direct" | "embed"; at: number } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ engine: cached.engine, cached: true });
  }
  if (breakerStatus() > 0) {
    cached = { engine: "embed", at: Date.now() };
    return NextResponse.json({ engine: "embed", cached: false });
  }
  const resolved = await resolveStream(PROBE_VIDEO_ID, {});
  const engine: "direct" | "embed" = resolved ? "direct" : "embed";
  cached = { engine, at: Date.now() };
  return NextResponse.json({ engine, cached: false });
}
