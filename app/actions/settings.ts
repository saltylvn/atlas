"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { audit } from "@/lib/audit";
import { KEY_PREFIX, keyHash, keyLabel } from "@/lib/domain/extensionForm";
import { rateLimit } from "@/lib/security/rateLimit";
import { getContext } from "@/lib/context";
import { NEWS_TOPICS } from "@/lib/domain/types";
import { createUserClient } from "@/lib/supabase/server";
import { firstIssue, formObject, type ActionResult } from "./_shared";

const list = (max: number) =>
  z
    .string()
    .max(1000)
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, max));

/** Comma-separated names (stores, subscriptions); each kept short, empty allowed. */
const entries = (max: number) =>
  z
    .string()
    .max(2000)
    .optional()
    .transform((s) => [...new Set((s ?? "").split(",").map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, max));

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const SettingsForm = z.object({
  displayName: z.string().trim().min(1).max(40),
  timezone: z.string().refine(validTz, "unknown timezone"),
  placeName: z.string().trim().min(1).max(60),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  dailyCapacityMin: z.coerce.number().int().min(60).max(720),
  jobKeywords: list(20),
  jobLocations: list(10),
  emailSubscriptions: entries(30),
  careerMinSalary: z.coerce.number().int().min(0).max(1_000_000),
  careerTargetSalary: z.coerce.number().int().min(0).max(1_000_000),
  careerMaxYears: z.coerce.number().int().min(0).max(15).optional(),
  careerBackground: z.string().trim().max(400).optional(),
  emailStores: entries(50),
});

export async function saveSettings(_: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formObject(fd);
  const p = SettingsForm.safeParse(raw);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const topics = NEWS_TOPICS.filter((t) => fd.get(`topic_${t}`) === "on");
  const { store } = await getContext();
  await store.settings.update({ ...p.data, newsTopics: topics.length ? topics : ["tech"] });
  await audit(store, { actor: "owner", action: "settings.update", target: "settings", detail: "", outcome: "success" });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

export async function setSwitch(name: "outboundEnabled" | "aiEnabled" | "holdRejections" | "modelReader", value: boolean): Promise<ActionResult> {
  const p = z.object({ name: z.enum(["outboundEnabled", "aiEnabled", "holdRejections", "modelReader"]), value: z.boolean() }).safeParse({ name, value });
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, now } = await getContext();
  // The model reader only ever sees email that arrives after it was turned on (docs/design-pipeline.md, 5.5):
  // turning it on sends no backlog, and turning it off and on again starts the clock again.
  const since = p.data.name === "modelReader" && p.data.value ? { modelReaderSince: now.toISOString() } : {};
  await store.settings.update({ [p.data.name]: p.data.value, ...since });
  await audit(store, { actor: "owner", action: `switch.${p.data.name}`, target: "settings", detail: `value=${p.data.value}`, outcome: "success" });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const ctx = await getContext();
  await audit(ctx.store, { actor: "owner", action: "auth.signout", target: "session", detail: "", outcome: "success" });
  if (ctx.mode === "live") {
    const db = await createUserClient();
    await db.auth.signOut({ scope: "global" });
  }
  redirect(ctx.mode === "live" ? "/login" : "/");
}

/**
 * Connects Atlas Autofill: makes a new key, keeps only its SHA-256, and returns the key once,
 * so the extension can pick it up from this page (or you can paste it). Connecting again
 * replaces the old key, which then stops working. Owner only, audited, never logged.
 */
export async function connectExtension(): Promise<ActionResult<{ key: string }>> {
  if (!rateLimit("extension-connect", 5, 10 * 60_000).allowed) return { ok: false, error: "Connected a lot just now. Try again in a few minutes." };
  const { store, settings, now } = await getContext();
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  await store.settings.update({ extensionKey: { hash: keyHash(key), prefix: keyLabel(key), createdAt: now.toISOString() } });
  await audit(store, { actor: "owner", action: "extension.connect", target: "atlas autofill", detail: settings.extensionKey ? "key replaced" : "key created", outcome: "success" });
  revalidatePath("/settings");
  return { ok: true, data: { key } };
}

/** Disconnects Atlas Autofill: the key stops working at once. */
export async function disconnectExtension(): Promise<ActionResult> {
  const { store } = await getContext();
  await store.settings.update({ extensionKey: undefined });
  await audit(store, { actor: "owner", action: "extension.disconnect", target: "atlas autofill", detail: "key removed", outcome: "success" });
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected. The extension can no longer reach Atlas." };
}
