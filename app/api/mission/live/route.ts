import { NextResponse, type NextRequest } from "next/server";
import { loadLive } from "@/lib/agents/live";
import { getContext } from "@/lib/context";

// Mission Control's live map asks this every few seconds while it is on screen.
// Gated by proxy.ts and again by getContext (owner + two-step). Read-only.
// Without ?detail=1 the answer holds agent names, timings and results only.
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const detail = request.nextUrl.searchParams.get("detail") === "1";
  return NextResponse.json(await loadLive(ctx, detail), { headers: { "Cache-Control": "no-store" } });
}
