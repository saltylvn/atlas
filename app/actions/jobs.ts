"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { MINUTES_SAVED } from "@/lib/domain/agents";
import { JOB_BOARDS } from "@/lib/domain/types";
import { firstIssue, formObject, id, type ActionResult } from "./_shared";

const NewWatch = z.object({
  company: z.string().trim().min(1).max(80),
  board: z.enum(JOB_BOARDS),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "letters, digits and dashes only"),
});

export async function addWatch(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = NewWatch.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const existing = await store.watches.list();
  if (existing.length >= 40) return { ok: false, error: "Watching 40 boards already." };
  if (existing.some((w) => w.board === p.data.board && w.slug === p.data.slug)) return { ok: false, error: "Already watching that board." };
  await store.watches.create(p.data);
  await audit(store, { actor: "owner", action: "jobs.watch.add", target: `${p.data.board}:${p.data.slug}`, detail: "", outcome: "success" });
  revalidatePath("/jobs");
  return { ok: true, message: "Watching" };
}

export async function removeWatch(watchId: string): Promise<ActionResult> {
  const p = id.safeParse(watchId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.watches.remove(p.data);
  revalidatePath("/jobs");
  return { ok: true };
}

const DraftCopied = z.object({
  itemId: z.string().trim().regex(/^(follow-up|thank-you):[A-Za-z0-9_-]{1,64}$/),
  company: z.string().trim().min(1).max(80),
});

/**
 * Logs a copied job follow-up or thank-you draft to the time-saved ledger.
 * Nothing is sent: the owner pastes it into their own mail app.
 */
export async function recordJobDraftCopied(itemId: string, company: string): Promise<ActionResult> {
  const p = DraftCopied.safeParse({ itemId, company });
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const kind = p.data.itemId.startsWith("thank-you") ? "thank-you" : "follow-up";
  await store.ledger.add({ agent: "career", activity: `Drafted ${kind} for ${p.data.company}`, minutesSaved: MINUTES_SAVED.draftWritten });
  revalidatePath("/team");
  return { ok: true, message: "Copied" };
}
