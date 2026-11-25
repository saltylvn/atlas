import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { atlasMcpHandler } from "@/lib/mcp/server";
import { showcaseContext } from "@/lib/mcp/showcase";
import { rateLimit } from "@/lib/security/rateLimit";

// The public demo connector: the same nine read-only MCP tools as /api/mcp, over a fictional job
// search (lib/mcp/showcase.ts). No sign-in, so anyone can add it to their own Claude and try it.
//
// Why it is safe to leave open:
// - It never builds the owner's store: showcase.ts imports no real data source, so there is
//   nothing real to reach, whatever a caller sends.
// - Off unless ATLAS_MCP_DEMO is set. Tighter limits than the real endpoint, per caller and in all.
// - Read-only, stateless, and it writes nothing (not even audit rows).

export const maxDuration = 15;

/** One caller, and everyone together, per 10 minutes on one server instance. */
export const DEMO_LIMIT = { perCaller: 40, total: 400, windowMs: 10 * 60_000 } as const;
/** A demo request is a small JSON-RPC message; anything larger is not one. */
const MAX_BODY = 16_000;

const refuse = (status: number, error: string, extra: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function POST(request: NextRequest) {
  if (!env().ATLAS_MCP_DEMO) return refuse(404, "The demo connector is not turned on.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return refuse(413, "Request too large.");
  const ip = (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
  const mine = rateLimit(`mcp-demo:${ip}`, DEMO_LIMIT.perCaller, DEMO_LIMIT.windowMs);
  const all = rateLimit("mcp-demo:all", DEMO_LIMIT.total, DEMO_LIMIT.windowMs);
  if (!mine.allowed || !all.allowed) return refuse(429, "The demo is busy. Try again in a few minutes.", { "Retry-After": String(Math.max(mine.retryAfterSec, all.retryAfterSec, 30)) });
  const res = await atlasMcpHandler(await showcaseContext(), "demo", { demo: true }).fetch(request);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Stateless POST only, like /api/mcp. */
export async function GET() {
  return refuse(405, "Use POST.", { Allow: "POST" });
}
export const DELETE = GET;
