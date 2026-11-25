"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { type ActionResult } from "./_shared";

// Your fixed answers for application forms, used by Atlas Autofill as you apply on your
// MacBook. Atlas never submits an application for you (removed 23 Nov 2026).

function refresh() {
  revalidatePath("/career/setup");
}

const Eligible = z.object({ authorized: z.enum(["yes", "no", ""]), sponsorship: z.enum(["yes", "no", ""]), workedHere: z.enum(["yes", "no", ""]), gender: z.enum(["male", "female", "nonbinary", ""]).default("") });

/**
 * Your fixed answers to the eligibility questions most forms require. The Apply Agent uses
 * them exactly as saved, and never drafts or guesses one. "" means you have not said, and a
 * form that requires it then waits for you.
 */
export async function saveEligibility(input: { authorized: string; sponsorship: string; workedHere: string; gender?: string }): Promise<ActionResult> {
  const p = Eligible.safeParse(input);
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.settings.update({ careerEligibility: p.data });
  // Which were set, never what they are.
  await audit(store, { actor: "owner", action: "apply.eligibility", target: "settings", detail: `${Object.values(p.data).filter(Boolean).length} of 4 answered`, outcome: "success" });
  refresh();
  return { ok: true, message: "Saved" };
}

const text = z.string().trim().max(120);
const Profile = z.object({
  phoneCode: z.string().trim().regex(/^\+?\d{0,4}$/).transform((s) => s.replace("+", "")),
  country: text,
  city: text,
  school: text,
  degree: text,
  discipline: text,
  gradYear: z.string().trim().regex(/^((19|20)\d\d)?$/),
});

/**
 * Your fixed profile answers for forms: phone code, country, city, school, degree, discipline
 * and graduation year. Atlas Autofill and the Apply Agent use them as written; in a list they
 * pick the choice that says the same thing, or leave it for you.
 */
export async function saveFormProfile(input: Record<string, string>): Promise<ActionResult> {
  const p = Profile.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the phone code (digits) and the year (four digits)." };
  const { store } = await getContext();
  await store.settings.update({ careerProfile: p.data });
  // Which were set, never what they are.
  await audit(store, { actor: "owner", action: "apply.profile", target: "settings", detail: `${Object.values(p.data).filter(Boolean).length} of 7 set`, outcome: "success" });
  refresh();
  return { ok: true, message: "Saved" };
}
