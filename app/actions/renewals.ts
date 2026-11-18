"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { anchorDayOf, isCalendarDate, nextDueOn, renewalHref, RENEWAL_CADENCES, RENEWAL_KINDS } from "@/lib/domain/renewals";
import { firstIssue, formObject, id, localDay, type ActionResult } from "./_shared";

function renewalError(err: z.ZodError): string {
  const field = err.issues[0]?.path[0];
  if (field === "url") return "Use an https link, with no username or password.";
  if (field === "dueOn") return "Use a real date.";
  return firstIssue(err);
}

const NewRenewal = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(RENEWAL_KINDS),
  dueOn: localDay.refine(isCalendarDate, "Use a real date"),
  leadDays: z.coerce.number().int().min(0).max(90).default(14),
  cadence: z.enum(RENEWAL_CADENCES).default("yearly"),
  url: z
    .string()
    .trim()
    .max(300)
    .default("")
    .refine((value) => value === "" || renewalHref(value) !== null, "Use an https link with no username"),
  notes: z.string().trim().max(300).default(""),
});

function refresh() {
  revalidatePath("/");
  revalidatePath("/renewals");
}

export async function createRenewal(_: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = NewRenewal.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: renewalError(parsed.error) };
  const { store } = await getContext();
  const input = parsed.data;
  const href = input.url ? renewalHref(input.url) : "";
  if (input.url && !href) return { ok: false, error: "url: Use an https link with no username" };
  await store.renewals.create({
    title: input.title,
    kind: input.kind,
    dueOn: input.dueOn,
    leadDays: input.leadDays,
    cadence: input.cadence,
    anchorDay: anchorDayOf(input.dueOn),
    url: href ?? "",
    notes: input.notes,
  });
  refresh();
  return { ok: true, message: "Added" };
}

export async function handleRenewal(renewalId: string): Promise<ActionResult> {
  const parsed = id.safeParse(renewalId);
  if (!parsed.success) return { ok: false, error: "Bad id" };
  const { store, today } = await getContext();
  const row = await store.renewals.get(parsed.data);
  if (!row) return { ok: false, error: "Renewal not found" };
  const next = nextDueOn(row.dueOn, row.anchorDay, row.cadence, today);
  if (!next) {
    await store.renewals.remove(row.id);
    await audit(store, { actor: "owner", action: "renewal.delete", target: row.id, detail: row.cadence, outcome: "success" });
    refresh();
    return { ok: true, message: "Cleared" };
  }
  const updated = await store.renewals.update(row.id, { dueOn: next });
  if (!updated) return { ok: false, error: "Renewal not found" };
  await audit(store, { actor: "owner", action: "renewal.roll", target: row.id, detail: next, outcome: "success" });
  refresh();
  return { ok: true, message: `Next due ${next}` };
}

export async function removeRenewal(renewalId: string): Promise<ActionResult> {
  const parsed = id.safeParse(renewalId);
  if (!parsed.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  const row = await store.renewals.get(parsed.data);
  if (!row) return { ok: false, error: "Renewal not found" };
  await store.renewals.remove(row.id);
  await audit(store, { actor: "owner", action: "renewal.delete", target: row.id, detail: row.cadence, outcome: "success" });
  refresh();
  return { ok: true };
}
