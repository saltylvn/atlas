"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { isAuthorizationId } from "@/lib/mcp/auth";
import { ownerWriteStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { createUserClient } from "@/lib/supabase/server";
import type { ActionResult } from "./_shared";

// Connecting Claude to Atlas (Step 4): the consent decision, the on/off switch, and revoking a
// client. Each goes through getContext() (owner, second factor), and each is audited.

/** Where Supabase sends the browser back to Claude: an https URL (or localhost in development) only. */
const safeRedirect = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost") ? url.toString() : null;
  } catch {
    return null;
  }
};

export async function decideConsent(formData: FormData): Promise<void> {
  const id = formData.get("authorization_id");
  const decision = formData.get("decision");
  if (!isAuthorizationId(typeof id === "string" ? id : null) || (decision !== "approve" && decision !== "deny")) redirect("/settings?claude=bad-request");
  if (!rateLimit("mcp-consent", 10, 10 * 60_000).allowed) redirect("/settings?claude=rate-limited");
  const ctx = await getContext();
  if (ctx.mode !== "live") redirect("/settings?claude=demo");
  if (decision === "approve" && ctx.settings.mcpEnabled !== true) redirect("/settings?claude=off");
  const db = await createUserClient();
  const { data, error } = decision === "approve" ? await db.auth.oauth.approveAuthorization(id as string, { skipBrowserRedirect: true }) : await db.auth.oauth.denyAuthorization(id as string, { skipBrowserRedirect: true });
  await audit(ctx.store, { actor: "owner", action: `mcp.consent.${decision}`, target: "claude", detail: error ? `failed: ${error.message.slice(0, 120)}` : "ok", outcome: error ? "error" : "success" });
  const back = safeRedirect(data?.redirect_url);
  if (error || !back) redirect("/settings?claude=consent-failed");
  redirect(back);
}

export async function setClaudeAccess(on: boolean): Promise<ActionResult> {
  const p = z.boolean().safeParse(on);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  await ownerWriteStore(ctx).settings.update({ mcpEnabled: p.data });
  await audit(ctx.store, { actor: "owner", action: p.data ? "mcp.enabled" : "mcp.disabled", target: "claude", detail: "", outcome: "success" });
  revalidatePath("/settings");
  return { ok: true, message: p.data ? "Claude may now read Atlas, after you approve it once." : "Claude access is off: every request is refused until you turn it on." };
}

export async function revokeClaude(clientId: string): Promise<ActionResult> {
  const p = z.uuid().safeParse(clientId);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Nothing to revoke in the demo." };
  const db = await createUserClient();
  const { error } = await db.auth.oauth.revokeGrant({ clientId: p.data });
  await audit(ctx.store, { actor: "owner", action: "mcp.revoke", target: p.data.slice(0, 40), detail: error ? error.message.slice(0, 120) : "", outcome: error ? "error" : "success" });
  revalidatePath("/settings");
  return error ? { ok: false, error: "Could not revoke it. Try again." } : { ok: true, message: "Revoked: that client's tokens stop working, and it must ask you again." };
}
