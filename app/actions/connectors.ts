"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { takeAiCall } from "@/lib/ai/budget";
import { activeProvider, aiName, structured } from "@/lib/ai/model";
import { geminiModel } from "@/lib/ai/gemini";
import { audit } from "@/lib/audit";
import { disconnectGmail as forgetGmail, gmailMissing, saveAppPasswordConnection, syncGmail } from "@/lib/connections/google";
import { syncNotion } from "@/lib/connections/notion";
import { disconnectCalendar as forgetCalendar } from "@/lib/connections/googleCalendar";
import { getContext } from "@/lib/context";
import { verifyLogin } from "@/lib/integrations/gmailImap";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { isAllowedEndpoint, pushConfigured, sendToAll } from "@/lib/push";
import { rateLimit } from "@/lib/security/rateLimit";
import { firstIssue, formObject, type ActionResult } from "./_shared";

export async function disconnectGmail(): Promise<ActionResult> {
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Nothing is connected in demo mode." };
  assertSessionIsOwner(ctx);
  await forgetGmail();
  await audit(ctx.store, { actor: "owner", action: "connection.gmail.disconnect", target: "gmail", detail: "credentials deleted, inbox cleared", outcome: "success" });
  revalidatePath("/connectors");
  revalidatePath("/inbox");
  return {
    ok: true,
    message: "Disconnected and the synced inbox deleted. If you used an app password, also delete it at myaccount.google.com/apppasswords.",
  };
}

/** Forgets the Google Calendar connection (revoking its token at Google). Gmail and the iCal address are untouched. */
export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Nothing is connected in demo mode." };
  assertSessionIsOwner(ctx);
  await forgetCalendar();
  await audit(ctx.store, { actor: "owner", action: "connection.google_calendar.disconnect", target: "google_calendar", detail: "token revoked and deleted", outcome: "success" });
  revalidatePath("/connectors");
  revalidatePath("/");
  return { ok: true, message: "Disconnected. The calendar falls back to your iCal address, in Atlas blue." };
}

const AppPassword = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .regex(/^[^@\s]+@(gmail\.com|googlemail\.com|[a-z0-9.-]+\.[a-z]{2,})$/, "enter your Gmail address"),
  // Google shows it as four groups of four letters; spaces are optional.
  appPassword: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toLowerCase())
    .pipe(z.string().regex(/^[a-z]{16}$/, "an app password is 16 letters")),
});

/**
 * Connects Gmail with an app password. The password is checked by signing in to Gmail
 * once, then sealed with the vault key; it is never returned, logged or audited.
 */
export async function connectGmailAppPassword(_: unknown, fd: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Connect Gmail in live mode. Demo mode uses a sample inbox." };
  assertSessionIsOwner(ctx);
  if (gmailMissing().length > 0) return { ok: false, error: `Set ${gmailMissing().join(", ")} in Vercel first.` };
  if (!rateLimit("gmail-app-password", 5, 15 * 60_000).allowed) return { ok: false, error: "Too many attempts. Wait 15 minutes." };

  const p = AppPassword.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };

  if (!(await verifyLogin({ user: p.data.email, pass: p.data.appPassword }))) {
    await audit(ctx.store, { actor: "owner", action: "connection.gmail.connect", target: "gmail_imap", detail: "sign-in refused", outcome: "denied" });
    return { ok: false, error: "Gmail didn't accept that. Check the address, and create a new app password if needed." };
  }
  await saveAppPasswordConnection({ email: p.data.email, appPassword: p.data.appPassword });
  await audit(ctx.store, { actor: "owner", action: "connection.gmail.connect", target: "gmail_imap", detail: "read-only: headers, and the text of job emails", outcome: "success" });

  const first = await syncGmail(ownerServiceStore()).catch(() => null);
  revalidatePath("/connectors");
  revalidatePath("/inbox");
  revalidatePath("/");
  return {
    ok: true,
    message: first?.status === "ok" ? `Connected. ${first.fetched} emails sorted, ${first.needsReply} need a reply.` : "Connected. The first sync will run shortly.",
  };
}

const Subscription = z.object({
  endpoint: z.string().max(1000).refine(isAllowedEndpoint, "not a recognized push service"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  }),
  device: z.string().trim().max(80).default(""),
});

export async function subscribePush(input: unknown): Promise<ActionResult> {
  const p = Subscription.safeParse(input);
  if (!p.success) return { ok: false, error: "That subscription was not accepted." };
  const { store } = await getContext();
  if (!pushConfigured()) return { ok: false, error: "Push is not configured on the server yet." };
  if ((await store.push.list()).length >= 10) return { ok: false, error: "Ten devices is the limit. Remove one first." };
  await store.push.add({ endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, device: p.data.device });
  await audit(store, { actor: "owner", action: "push.subscribe", target: new URL(p.data.endpoint).hostname, detail: p.data.device, outcome: "success" });
  revalidatePath("/connectors");
  return { ok: true, message: "Notifications on for this device" };
}

export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  const p = z.string().max(1000).safeParse(endpoint);
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.push.remove(p.data);
  await audit(store, { actor: "owner", action: "push.unsubscribe", target: "device", detail: "", outcome: "success" });
  revalidatePath("/connectors");
  return { ok: true };
}

export async function sendTestPush(): Promise<ActionResult> {
  const { store, settings } = await getContext();
  if (!settings.outboundEnabled) return { ok: false, error: "The kill switch is on." };
  if (!rateLimit("push-test", 5, 10 * 60_000).allowed) return { ok: false, error: "Try again in a few minutes." };
  const r = await sendToAll(store, { title: "Atlas", body: "Test notification. Your morning brief will arrive like this.", url: "/" });
  return r.sent > 0 ? { ok: true, message: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}` } : { ok: false, error: "No device received it. Turn notifications on from the installed app first." };
}

/** Connectors: read the Resumes database in Notion now and update the resume links. */
export async function syncNotionNow(): Promise<ActionResult> {
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Notion syncs in live mode. Demo mode uses sample data." };
  assertSessionIsOwner(ctx);
  if (!rateLimit("notion-sync", 6, 5 * 60_000).allowed) return { ok: false, error: "Synced a lot just now. Try again in a few minutes." };
  const res = await syncNotion(ctx.store, ctx.settings, new Date());
  if (!res) return { ok: false, error: "Notion is not set up yet: add NOTION_TOKEN in Vercel, then redeploy." };
  await audit(ctx.store, {
    actor: "owner",
    action: "connection.notion.sync",
    target: "notion",
    detail: res.sync.ok ? `${res.sync.roles} roles, ${res.sync.resumes} resumes` : res.sync.message,
    outcome: res.sync.ok ? "success" : "error",
  });
  for (const path of ["/connectors", "/roles", "/settings", "/mission", "/growth"]) revalidatePath(path);
  if (!res.sync.ok) return { ok: false, error: res.sync.message };
  return { ok: true, message: `Synced ${res.sync.roles} roles and ${res.sync.resumes} resume${res.sync.resumes === 1 ? "" : "s"}${res.changed ? "" : ". Nothing had changed"}.` };
}

const Ping = z.object({ ready: z.boolean(), word: z.string().min(1).max(40) });

const STATUS_HINT: Record<number, string> = {
  400: "The provider rejected the request. This is usually a model name it does not know.",
  401: "The key was not accepted.",
  403: "The key was not accepted, or the API is not enabled for its project.",
  404: "The model was not found. Check the model name setting.",
  429: "Rate limit or quota reached. On Gemini, check that billing is on for the key's project.",
};

/**
 * One tiny call to the configured model (Claude or Gemini), to confirm a new key works.
 * It sends no personal data, counts against the daily cap, and reports the model and cost.
 */
export async function testAiModel(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!rateLimit("ai-test", 5, 10 * 60_000).allowed) return { ok: false, error: "Tested a few times just now. Try again in a few minutes." };
  const gate = await takeAiCall(ctx.store, ctx.settings, "test");
  if (!gate.allowed) return { ok: false, error: gate.why.replace(", so the offline drafter ran", "") };
  const started = Date.now();
  // The same path the agents use: the writing model first, the fast one if it does not answer in time.
  const res = await structured(Ping, "Set ready to true and word to the single word that is in the data.", JSON.stringify({ word: "atlas" }), { budgetMs: 25_000 });
  const ms = Date.now() - started;
  if (res.ok) {
    const good = res.value.ready && res.value.word.trim().toLowerCase() === "atlas";
    const writer = activeProvider() === "gemini" ? geminiModel("writer") : "";
    const fellBack = writer !== "" && res.usage.model !== writer;
    return good
      ? {
          ok: true,
          message: fellBack
            ? `${aiName()} works through its fast model: ${writer} did not answer in time, so ${res.usage.model} answered instead (${(ms / 1000).toFixed(1)} s in all). Atlas does this on its own whenever the writing model is slow or busy.`
            : `${aiName()} answered in ${(ms / 1000).toFixed(1)} s with ${res.usage.model} (about $${res.usage.costUsd.toFixed(4)}).`,
        }
      : { ok: false, error: `${aiName()} answered, but not with what was asked. Try once more.` };
  }
  const why =
    res.reason === "error"
      ? res.status
        ? `${STATUS_HINT[res.status] ?? "The provider answered with an error."} (HTTP ${res.status})`
        : "Neither model answered in time. That is on the provider's side (busy or down); the bots use their rules until it is back. Try again in a few minutes."
      : res.reason === "refused"
        ? "The model declined the test."
        : res.reason === "invalid"
          ? "The reply was not in the expected shape."
          : "No AI key is set.";
  return { ok: false, error: `${aiName()}: ${why}` };
}
