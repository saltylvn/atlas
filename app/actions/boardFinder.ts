"use server";

import { z } from "zod";
import { findBoards, type FinderResult } from "@/lib/agents/boardFinder";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { rateLimit } from "@/lib/security/rateLimit";
import { firstIssue, formObject, type ActionResult } from "./_shared";

const Input = z.object({
  company: z.string().trim().min(1, "Name the company").max(80),
  website: z.string().trim().max(200).optional().default(""),
});

/** Finds a company's public job board. It adds nothing: you press Watch on what it found. */
export async function findCompanyBoard(_: unknown, fd: FormData): Promise<ActionResult<FinderResult>> {
  const ctx = await getContext();
  const p = Input.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  // Each search can make up to 18 free requests and spend 2 Firecrawl credits: a few a minute is plenty.
  if (!rateLimit("board-finder", 5, 60_000).allowed) return { ok: false, error: "Five searches a minute at most. Try again shortly." };
  const res = await findBoards(ctx, { company: p.data.company, website: p.data.website });
  if (res.credits) await audit(ctx.store, { actor: "owner", action: "data.board-finder", target: p.data.company, detail: `${res.credits} Firecrawl credits`, outcome: "success" });
  return { ok: true, data: res };
}
