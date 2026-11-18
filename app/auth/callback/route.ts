import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

// OAuth return leg: trade the one-time code for a session, then let proxy.ts decide
// (owner check, then the MFA step). Only relative, same-origin redirects.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 512) return NextResponse.redirect(new URL("/login?error=callback", request.url));
  const db = await createUserClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/login?error=callback" : "/mfa", request.url));
}
