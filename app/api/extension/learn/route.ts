import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { cors, extensionContext, preflight } from "@/lib/extensionApi";

// "Save to my answers" in Atlas Autofill: an answer you wrote or corrected on a form, saved to
// one question of your answer bank, so the next form gets it. Only on your click, one at a time,
// and only into a question the bank already has. Nothing else in your settings can be changed here.
export const OPTIONS = preflight;
const Learn = z.object({ id: z.string().max(40), value: z.string().max(4000) });

export async function POST(request: NextRequest) {
  const got = await extensionContext(request, "/api/extension/learn");
  if (got instanceof NextResponse) return got;
  const p = Learn.safeParse(await request.json().catch(() => null));
  const known = new Set(ANSWER_BANK.map((q) => q.id));
  if (!p.success || !known.has(p.data.id)) return cors(request, NextResponse.json({ error: "That answer cannot be saved to your answer bank." }, { status: 400 }));
  const value = p.data.value.replace(/\u0000/g, "").trim();
  const answers = { ...(got.ctx.settings.careerAnswers ?? {}), [p.data.id]: value };
  await got.persist.settings.update({ careerAnswers: answers });
  await audit(got.ctx.store, { actor: "owner", action: "extension.learn", target: p.data.id, detail: `${value.length} characters`, outcome: "success" });
  return cors(request, NextResponse.json({ ok: true }));
}
