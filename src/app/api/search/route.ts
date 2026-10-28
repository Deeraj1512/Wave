import { NextRequest, NextResponse } from "next/server";
import { searchOriginals } from "@/lib/yt/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchCache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const hit = searchCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ ...(hit.data as object), cached: true });
  }

  try {
    const result = await searchOriginals(q);
    searchCache.set(q.toLowerCase(), { at: Date.now(), data: result });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "search failed" }, { status: 502 });
  }
}
