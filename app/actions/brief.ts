"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { MINUTES_SAVED } from "@/lib/domain/agents";
import { BRIEFED_ACTIVITY, briefedSlots, caughtUpActivity, pickBriefDay } from "@/lib/domain/briefSchedule";
import { longDate } from "@/lib/domain/dates";
import { BRIEF_SLOTS } from "@/lib/domain/types";
import { structured } from "@/lib/ai/model";
import { takeAiCall } from "@/lib/ai/budget";
import { BriefRewrite, Digest, briefData, briefTask, digestData, digestTask } from "@/lib/ai/prompts";
import { loadBrief } from "@/lib/briefing";
import { getNews } from "@/lib/integrations/news";
import type { ActionResult } from "./_shared";

export async function polishBrief(): Promise<ActionResult<z.infer<typeof BriefRewrite>>> {
  const ctx = await getContext();
  const gate = await takeAiCall(ctx.store, ctx.settings, "brief");
  if (!gate.allowed) return { ok: false, error: gate.why };
  const { brief } = await loadBrief(ctx);
  const res = await structured(BriefRewrite, briefTask(), briefData(brief, ctx.settings.displayName, longDate(ctx.today)));
  await audit(ctx.store, { actor: "ai", action: "brief.polish", target: ctx.today, detail: res.ok ? "" : res.reason, outcome: res.ok ? "success" : "error" });
  if (!res.ok) return { ok: false, error: res.reason === "refused" ? "Claude declined this one. The rules-based brief stands." : "Claude was unavailable. The rules-based brief stands." };
  return { ok: true, data: res.value };
}

/**
 * Confirms you read a brief: one of today's, or one from a day you are catching up on.
 * Each brief is confirmed on its own, once.
 */
export async function markBriefed(slot: string, day?: string): Promise<ActionResult> {
  const p = z.enum(BRIEF_SLOTS).safeParse(slot);
  if (!p.success) return { ok: false, error: "Unknown brief" };
  const { store, today, settings, now } = await getContext();
  const forDay = day === undefined ? today : pickBriefDay(day, today);
  if (day !== undefined && day !== forDay) return { ok: false, error: "That brief is too old to catch up on." };
  if (forDay !== today) {
    // Only a brief that was actually saved that day can be confirmed.
    const saved = await store.briefs.forDate(forDay);
    if (!saved.some((b) => b.slot === p.data)) return { ok: false, error: "No such brief that day." };
  }
  const recent = await store.ledger.since(new Date(now.getTime() - 7 * 86_400_000).toISOString());
  if (!briefedSlots(recent, forDay, settings.timezone).includes(p.data)) {
    await store.ledger.add({
      agent: "chief-of-staff",
      activity: forDay === today ? BRIEFED_ACTIVITY[p.data] : caughtUpActivity(p.data, forDay),
      minutesSaved: p.data === "afternoon" ? MINUTES_SAVED.afternoonBriefRead : MINUTES_SAVED.briefRead,
    });
  }
  revalidatePath("/");
  revalidatePath("/team");
  return { ok: true };
}

export async function digestNews(): Promise<ActionResult<z.infer<typeof Digest>>> {
  const { store, settings } = await getContext();
  const gate = await takeAiCall(store, settings, "digest");
  if (!gate.allowed) return { ok: false, error: gate.why };
  const news = await getNews(settings.newsTopics);
  if (news.items.length === 0) return { ok: false, error: "No headlines to digest right now." };
  const res = await structured(Digest, digestTask(), digestData(news.items));
  await audit(store, { actor: "ai", action: "news.digest", target: "news", detail: res.ok ? "" : res.reason, outcome: res.ok ? "success" : "error" });
  if (!res.ok) return { ok: false, error: "Claude was unavailable. Headlines are below." };
  await store.ledger.add({ agent: "news", activity: "News digest", minutesSaved: MINUTES_SAVED.newsDigest });
  revalidatePath("/team");
  return { ok: true, data: res.value };
}
