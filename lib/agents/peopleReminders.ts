import "server-only";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { remindersDue } from "@/lib/domain/people";
import { sendToAll } from "@/lib/push";

/**
 * Texts you scheduled whose time has come: a notification on your phone opens the draft in
 * Atlas, where one tap opens it in Messages. Atlas never sends the text. Each reminder goes out
 * once. Runs with every 2-hour sync, so it can be up to two hours late; the calendar event you
 * may add when scheduling rings at the exact minute.
 */
export async function remindScheduledTexts(ctx: Pick<Context, "settings" | "now">, persist: Store): Promise<number> {
  const due = remindersDue(await persist.messages.list(), ctx.now);
  if (due.length === 0) return 0;
  const contacts = new Map((await persist.contacts.list()).map((c) => [c.id, c]));
  let sent = 0;
  for (const m of due.slice(0, 10)) {
    // Marked first, so a retry never sends the same reminder twice.
    await persist.messages.update(m.id, { remindedAt: ctx.now.toISOString() });
    if (!ctx.settings.outboundEnabled) continue;
    const name = contacts.get(m.contactId)?.name ?? "someone";
    await sendToAll(persist, { title: `Time to text ${name}`.slice(0, 80), body: m.body.slice(0, 200), url: `/people?scheduled=${m.id}#scheduled` }).catch(() => undefined);
    sent++;
  }
  return sent;
}
