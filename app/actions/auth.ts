"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env, mode } from "@/lib/env";
import { rateLimit } from "@/lib/security/rateLimit";
import { decide, isPlainOrigin, type Claims } from "@/lib/supabase/gate";
import { createUserClient } from "@/lib/supabase/server";
import { afterSignIn } from "@/lib/mcp/consentReturn";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * True when the session belongs to the configured owner, at any assurance level. The
 * sign-in and MFA actions run before the second factor, so they cannot use getContext();
 * they still refuse every account but the owner's.
 */
async function isOwnerSession(db: Awaited<ReturnType<typeof createUserClient>>): Promise<boolean> {
  const { data } = await db.auth.getClaims();
  return decide((data?.claims ?? null) as Claims | null, env().ATLAS_OWNER_EMAIL, false, "/mfa") === "allow";
}

export async function signInWithGoogle(): Promise<void> {
  if (mode() !== "live") redirect("/");
  if (!rateLimit(`login:${await clientIp()}`, 10, 15 * 60_000).allowed) redirect("/login?error=rate_limited");
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  // The return address is built from request headers, so it must be a bare origin.
  // (Supabase also only honors redirect URLs on its allowlist.)
  if (!isPlainOrigin(origin)) redirect("/login?error=oauth");
  const db = await createUserClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Supabase only honors redirect URLs on its allowlist (Auth > URL Configuration).
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: "select_account", login_hint: env().ATLAS_OWNER_EMAIL ?? "" },
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function startEnrollment(): Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string }> {
  if (!rateLimit(`mfa-enroll:${await clientIp()}`, 6, 10 * 60_000).allowed) return { ok: false, error: "Too many attempts. Wait 10 minutes." };
  const db = await createUserClient();
  if (!(await isOwnerSession(db))) return { ok: false, error: "Sign in first." };
  const { data: factors } = await db.auth.mfa.listFactors();
  // Once an authenticator is set up, a session that has not passed it can never add
  // another one. Otherwise a stolen first-factor session could enroll its own
  // authenticator and walk past two-step sign-in. (Supabase enforces this too.)
  if ((factors?.all ?? []).some((f) => f.status === "verified")) return { ok: false, error: "An authenticator is already set up. Enter its code instead." };
  // Remove abandoned, unverified factors so enrollment can restart cleanly.
  for (const f of factors?.all ?? []) if (f.status === "unverified") await db.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: `Atlas ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { ok: false, error: "Could not start enrollment." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotp(factorId: string, code: string): Promise<{ ok: false; error: string } | never> {
  const p = z.object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).safeParse({ factorId, code });
  if (!p.success) return { ok: false, error: "Enter the 6-digit code." };
  if (!rateLimit(`mfa:${await clientIp()}`, 8, 10 * 60_000).allowed) return { ok: false, error: "Too many attempts. Wait 10 minutes." };
  const db = await createUserClient();
  if (!(await isOwnerSession(db))) return { ok: false, error: "Sign in first." };
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId: p.data.factorId, code: p.data.code });
  if (error) return { ok: false, error: "That code didn't match. Check your authenticator's clock." };
  // Back to Claude's consent request when sign-in interrupted one, else home.
  redirect(await afterSignIn(true));
}

export async function signOutToLogin(): Promise<void> {
  if (mode() === "live") {
    const db = await createUserClient();
    await db.auth.signOut();
  }
  redirect("/login");
}
