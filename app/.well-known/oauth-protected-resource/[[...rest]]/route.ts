import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { resourceMetadata } from "@/lib/mcp/auth";

// OAuth protected resource metadata (RFC 9728) for Atlas's MCP endpoint: tells Claude that
// Supabase Auth is the authorization server to sign in with. Public, no data. Answers both
// /.well-known/oauth-protected-resource and its /api/mcp-suffixed form, as MCP clients try either.

export async function GET(request: NextRequest) {
  const url = env().NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return NextResponse.json({ error: "Atlas is not connected to Supabase." }, { status: 404 });
  return NextResponse.json(resourceMetadata(new URL(request.url).origin, url), { headers: { "Cache-Control": "public, max-age=300" } });
}
