import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { TokenClaims } from "./auth";

/**
 * The claims of a Supabase-issued access token, or null. getClaims verifies the signature against
 * the project's signing keys and the expiry; lib/mcp/auth.ts `decideMcp` then decides who it is.
 */
export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getClaims(token);
  return error || !data?.claims ? null : (data.claims as TokenClaims);
}
