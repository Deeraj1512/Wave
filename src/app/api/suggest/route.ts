import { NextRequest, NextResponse } from "next/server";
import { searchSuggestions } from "@/lib/yt/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** YouTube-style search completions for the typing box (?q=partial). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ suggestions: [] });

  try {
    const suggestions = await searchSuggestions(q);
    return NextResponse.json({ suggestions });
  } catch {
    // suggestions are a nicety — an empty list never breaks search
    return NextResponse.json({ suggestions: [] });
  }
}
