import { NextResponse, type NextRequest } from "next/server";
import type { Context } from "@/lib/context";
import { demoStore } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { localDate, localTime } from "@/lib/domain/dates";
import { env, mode } from "@/lib/env";
import { bearer, decideMcp, resourceMetadataUrl } from "@/lib/mcp/auth";
import { verifyToken } from "@/lib/mcp/verify";
import { atlasMcpHandler } from "@/lib/mcp/server";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";

// Atlas's MCP endpoint (Step 4): Claude reads your job search here, read-only. Outside the browser
// session gate (lib/supabase/gate.ts); it checks its own OAuth token instead (lib/mcp/auth.ts).
// Supabase Auth is the authorization server; this route is only the protected resource.
// Stateless: a fresh MCP server per request, nothing kept between them.

export const maxDuration = 30;

const unauthorized = (request: NextRequest, status: 401 | 403, error: string) =>
  NextResponse.json({ error }, { status, headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(new URL(request.url).origin)}"`, "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!rateLimit("mcp", 60, 10 * 60_000).allowed) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  const m = mode();
  let store: Store;
  let clientId = "demo";
  if (m === "live") {
    if (!serviceReady()) return NextResponse.json({ error: "Atlas is not configured for Claude." }, { status: 503 });
    const token = bearer(request.headers.get("authorization"));
    if (!token) return unauthorized(request, 401, "Connect Claude to Atlas: sign in when Claude asks.");
    store = ownerServiceStore();
    const settings = await store.settings.get();
    const d = decideMcp(await verifyToken(token), { id: ownerUserId(), email: env().ATLAS_OWNER_EMAIL }, settings.mcpEnabled === true, Math.floor(Date.now() / 1000));
    if (!d.ok) return unauthorized(request, d.status, d.error);
    clientId = d.clientId;
  } else if (m === "demo") store = demoStore();
  else return NextResponse.json({ error: "Atlas is not configured." }, { status: 503 });

  const settings = await store.settings.get();
  const now = new Date();
  const ctx: Context = { mode: m, userId: m === "live" ? (ownerUserId() ?? "") : "demo", store, settings, now, today: localDate(now, settings.timezone), time: localTime(now, settings.timezone) };
  // When Claude last read Atlas, at most once a minute, so Settings can say so.
  if (!settings.mcpLastUsedAt || now.getTime() - Date.parse(settings.mcpLastUsedAt) > 60_000) await store.settings.update({ mcpLastUsedAt: now.toISOString() }).catch(() => undefined);
  const res = await atlasMcpHandler(ctx, clientId).fetch(request);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** The endpoint speaks POST only (stateless Streamable HTTP): no stream to open, nothing to close. */
export async function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
