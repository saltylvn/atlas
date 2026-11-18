import { NextResponse, type NextRequest } from "next/server";
import { env, mode } from "@/lib/env";
import { bearerMatches } from "@/lib/security/bearer";
import { rateLimit } from "@/lib/security/rateLimit";
import { createServiceClient } from "@/lib/supabase/server";

// Supabase pauses a free project after 7 days with no database activity.
// A scheduled job (.github/workflows/keepalive.yml) calls this twice a week so a
// week away from Atlas never takes it offline. It runs one tiny read query.
// Bearer-token protected (constant-time check), rate limited, and it returns nothing
// about the data.

export async function POST(request: NextRequest) {
  const e = env();
  // Check the token first: a stranger learns nothing about how this deployment is set
  // up, and cannot use up the limit and block the real keep-alive until the database
  // paused. With no token configured, nothing matches.
  if (!bearerMatches(request.headers.get("authorization"), e.ATLAS_KEEPALIVE_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (mode() !== "live" || !e.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!rateLimit("keepalive", 12, 60 * 60_000).allowed) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const { error } = await createServiceClient().from("settings").select("owner_id", { head: true, count: "exact" }).limit(1);
  if (error) return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
