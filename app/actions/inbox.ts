"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { archiveInGmail, syncGmail, unsubscribeSender } from "@/lib/connections/google";
import { getContext } from "@/lib/context";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

export async function setInboxDone(itemId: string, done: boolean): Promise<ActionResult> {
  const p = z.object({ itemId: id, done: z.boolean() }).safeParse({ itemId, done });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.inbox.setDone(p.data.itemId, p.data.done);
  revalidatePath("/inbox");
  revalidatePath("/");
  return { ok: true };
}

// Same shape the inbox table allows; the Gmail step accepts only real (hex) Gmail ids.
const MessageId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Domain = z
  .string()
  .max(100)
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);

function refreshInbox() {
  revalidatePath("/inbox");
  revalidatePath("/");
}

/** One-click archive: removes the Inbox label in Gmail for the emails you ticked. Nothing is deleted. */
export async function archiveEmails(messageIds: string[]): Promise<ActionResult> {
  const p = z.array(MessageId).min(1).max(50).safeParse(messageIds);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  if (ctx.mode !== "live") {
    await ctx.store.inbox.remove(p.data);
    refreshInbox();
    return { ok: true, message: "Archived (demo: sample data, nothing sent to Gmail)" };
  }
  assertSessionIsOwner(ctx);
  if (!rateLimit("gmail-archive", 30, 10 * 60_000).allowed) return { ok: false, error: "Archived a lot just now. Try again in a few minutes." };
  const res = await archiveInGmail(ownerServiceStore(), p.data);
  await audit(ctx.store, {
    actor: "owner",
    action: "inbox.archive",
    target: "gmail",
    detail: res.status === "ok" ? `${res.archived} archived, ${res.missing} already gone` : res.status,
    outcome: res.status === "ok" ? "success" : "error",
  });
  refreshInbox();
  if (res.status === "ok") return { ok: true, message: res.archived === 1 ? "Archived" : `${res.archived} archived` };
  return { ok: false, error: res.status === "not_connected" ? "Archive needs the Gmail app-password connection." : res.message };
}

export type UnsubscribeResult = { domain: string; status: "unsubscribed" | "link" | "mailto" | "none" | "error"; url?: string; message?: string };

/**
 * Unsubscribes from the senders you approved. Atlas sends a one-click unsubscribe when
 * the sender supports it, and otherwise returns the sender's own link for you to open.
 * Either way the sender is not proposed again (a failed attempt stays on the list).
 */
export async function unsubscribeSenders(domains: string[]): Promise<ActionResult<UnsubscribeResult[]>> {
  const p = z.array(Domain).min(1).max(10).safeParse(domains);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const already = ctx.settings.emailUnsubscribed ?? [];

  if (ctx.mode !== "live") {
    await ctx.store.settings.update({ emailUnsubscribed: [...new Set([...already, ...p.data])].slice(-500) });
    refreshInbox();
    return { ok: true, message: "Demo: sample data, nothing sent", data: p.data.map((domain) => ({ domain, status: "unsubscribed" as const })) };
  }
  assertSessionIsOwner(ctx);
  if (!rateLimit("unsubscribe", 20, 60 * 60_000).allowed) return { ok: false, error: "Unsubscribed a lot just now. Try again later." };

  const results: UnsubscribeResult[] = [];
  for (const domain of p.data) {
    const r = await unsubscribeSender(domain);
    if (r.status === "not_connected") return { ok: false, error: "Unsubscribe needs the Gmail app-password connection." };
    results.push(
      r.status === "link" || r.status === "mailto" ? { domain, status: r.status, url: r.url } : r.status === "error" ? { domain, status: "error", message: r.message } : { domain, status: r.status },
    );
    await audit(ctx.store, { actor: "owner", action: "email.unsubscribe", target: domain, detail: r.status, outcome: r.status === "error" ? "error" : "success" });
  }
  const settled = results.filter((r) => r.status !== "error").map((r) => r.domain);
  await ctx.store.settings.update({ emailUnsubscribed: [...new Set([...already, ...settled])].slice(-500) });
  refreshInbox();
  const sent = results.filter((r) => r.status === "unsubscribed").length;
  return { ok: true, message: `${sent} unsubscribed${results.length > sent ? `, ${results.length - sent} need you to finish` : ""}`, data: results };
}

/** Keep a sender: adds it to your stores and senders to keep, so it is never proposed again. */
export async function keepSender(name: string): Promise<ActionResult> {
  const p = z.string().trim().min(2).max(80).safeParse(name);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const stores = ctx.settings.emailStores ?? [];
  if (!stores.some((s) => s.toLowerCase() === p.data.toLowerCase())) await ctx.store.settings.update({ emailStores: [...stores, p.data].slice(0, 50) });
  await audit(ctx.store, { actor: "owner", action: "email.keep", target: p.data, detail: "", outcome: "success" });
  refreshInbox();
  return { ok: true, message: `Keeping ${p.data}` };
}

export async function syncInbox(): Promise<ActionResult> {
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Gmail sync runs in live mode. The demo inbox is sample data." };
  assertSessionIsOwner(ctx);
  if (!rateLimit("gmail-sync", 6, 10 * 60_000).allowed) return { ok: false, error: "Synced a lot just now. Try again in a few minutes." };
  const result = await syncGmail(ownerServiceStore());
  await audit(ctx.store, {
    actor: "owner",
    action: "inbox.sync",
    target: "gmail",
    detail: result.status === "ok" ? `${result.fetched} messages` : result.status,
    outcome: result.status === "ok" ? "success" : "error",
  });
  revalidatePath("/inbox");
  revalidatePath("/");
  if (result.status === "ok") {
    await ctx.store.ledger.add({ agent: "email", activity: `Inbox triage (${result.fetched} emails)`, minutesSaved: Math.min(30, Math.round(result.fetched / 2)) });
    return { ok: true, message: `${result.fetched} emails sorted, ${result.needsReply} need a reply` };
  }
  return { ok: false, error: result.status === "not_connected" ? "Connect Gmail first." : result.message };
}
