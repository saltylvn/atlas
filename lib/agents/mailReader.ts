import "server-only";
import { takeAiCallWithin, type Gate } from "@/lib/ai/budget";
import { structuredWithin, type AiResult } from "@/lib/ai/model";
import { mailReaderTask, MailReadingOut } from "@/lib/ai/prompts";
import { readJobMailTexts } from "@/lib/connections/google";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { modelWait } from "@/lib/domain/deadline";
import { prefsFrom, tagInbox } from "@/lib/domain/emailAgent";
import { checkReading, MIN_TEXT_CHARS, NOT_READ, READER_DAILY_CAP, READER_PER_RUN, READER_PURPOSE, readerCandidates, readerPayload, readingEvent, type RawReading, type ReaderOutcome } from "@/lib/domain/mailReader";
import type { Settings } from "@/lib/domain/types";

// The Pipeline's model reader at run time (docs/design-pipeline.md, 5.4 to 5.6, 6 and 8).
// One step of the Applications Agent's part in the full sync. Never in the 15-minute watch.
//
// It does nothing at all unless the owner turned on "Let the AI model read what rules cannot"
// (off by default). When it is on, for each email rules left as "none" (lib/domain/mailReader.ts
// picks them and says exactly what of each is sent):
//   1. the gate every model call passes (kill switch, AI switch, daily limit), and before it
//      the reader's own cap of 12 calls a day;
//   2. the email is marked as handed to the model, in one conditional write, BEFORE the call:
//      its text leaves Atlas at most once, whatever happens next;
//   3. one call to the fast model through lib/ai/model.ts, which fences the email as untrusted
//      data and validates the answer against the schema;
//   4. the answer is checked against the email in pure code; one that fails is dropped;
//   5. one that passes is stored as a timeline row decided by "model": shadow mode. It moves
//      no stage, is listed nowhere, pings no phone and writes no Heard back row.
// A call that fails falls back to rules: nothing is stored and the email is not sent again.
// When the provider itself is failing, the run stops asking and the rest wait for the next sync.
// Nothing of an email is logged, traced or audited here: counts only.

/** The longest one reader call waits. The fast model answers in about a second. */
const READER_WAIT_MS = 15_000;
/** Kept back for the rest of the Applications Agent's run: roles, follow-ups, postings, its log row. */
const AFTER_READER_MS = 60_000;

/** What the reader reaches outside the database. Swapped in tests, which must reach neither Gmail nor a model. */
export interface ReaderDeps {
  readTexts: (ids: string[]) => Promise<Map<string, string> | null>;
  gate: (store: Store, settings: Settings, waitMs: number) => Promise<Gate>;
  ask: (data: string, waitMs: number) => Promise<AiResult<RawReading>>;
}

const LIVE: ReaderDeps = {
  readTexts: readJobMailTexts,
  gate: (store, settings, waitMs) => takeAiCallWithin(store, settings, READER_PURPOSE, waitMs),
  ask: (data, waitMs) => structuredWithin(waitMs, MailReadingOut, mailReaderTask(), data, { tier: "fast", effort: "low" }),
};

/** One run of the model reader. `persist` is the owner-scoped service store. Never throws. */
export async function readWithModel(ctx: Pick<Context, "settings" | "mode" | "deadline" | "now">, persist: Store, deps: ReaderDeps = LIVE): Promise<ReaderOutcome> {
  const out: ReaderOutcome = { ...NOT_READ };
  if (ctx.settings.modelReader !== true) return out;
  const skipped = (why: string): ReaderOutcome => ({ ...out, status: "skipped", why });
  if (!ctx.settings.aiEnabled || !ctx.settings.outboundEnabled) return skipped("AI is switched off in Settings");
  // The demo has no Gmail to read from.
  if (ctx.mode !== "live" && deps.readTexts === readJobMailTexts) return skipped("demo mode");
  try {
    const used = await persist.aiUsage.countToday(READER_PURPOSE);
    const room = Math.min(READER_PER_RUN, READER_DAILY_CAP - used);
    if (room <= 0) return skipped(`today's ${READER_DAILY_CAP} reader calls are used`);

    const [items, apps, events] = await Promise.all([persist.inbox.list(), persist.applications.list(), persist.applicationEvents.index()]);
    const waiting = readerCandidates(tagInbox(items, prefsFrom(ctx.settings)), apps, events, ctx.settings.modelReaderSince);
    out.status = "ran";
    out.waiting = waiting.length;
    if (waiting.length === 0) return out;
    if (modelWait(READER_WAIT_MS, ctx.deadline, Date.now(), AFTER_READER_MS) === 0) return skipped("not enough time left in this run; the next sync reads them");

    const batch = waiting.slice(0, room);
    const texts = await deps.readTexts(batch.map((c) => c.messageId));
    if (!texts) return skipped("Gmail was not reachable over the app-password connection");

    for (const c of batch) {
      const text = texts.get(c.messageId);
      // Gmail did not return it this time: it waits, unmarked.
      if (text === undefined) continue;
      const { data, sent } = readerPayload(c, text);
      if (sent.length < MIN_TEXT_CHARS) {
        // Nothing of its own to read (an image, or only a quoted thread). Settled without a call.
        await persist.inbox.claimForModel(c.messageId, ctx.now.toISOString());
        out.nothing++;
        continue;
      }
      const waitMs = modelWait(READER_WAIT_MS, ctx.deadline, Date.now(), AFTER_READER_MS);
      if (waitMs === 0) {
        out.why = "the run was short on time";
        break;
      }
      const gate = await deps.gate(persist, ctx.settings, waitMs);
      if (!gate.allowed) {
        out.why = gate.why;
        break;
      }
      // Claim, then act: once marked, this email is never sent again, even if the call fails.
      if (!(await persist.inbox.claimForModel(c.messageId, ctx.now.toISOString()))) continue;
      out.sent++;
      const res = await deps.ask(data, waitMs).catch((): AiResult<RawReading> => ({ ok: false, reason: "error" }));
      if (res.usage) {
        out.model = res.usage.model;
        out.inputTokens += res.usage.inputTokens;
        out.outputTokens += res.usage.outputTokens;
        out.costUsd = Math.round((out.costUsd + res.usage.costUsd) * 1_000_000) / 1_000_000;
      }
      if (!res.ok) {
        out.failed++;
        // The provider is busy, unreachable or not set up: asking again this run would only spend the day's calls.
        if (res.reason === "error" || res.reason === "not_configured") {
          out.why = "the model gave no answer";
          break;
        }
        continue;
      }
      const checked = checkReading(res.value, { sent, receivedAt: c.receivedAt, standing: c.standing });
      if (checked.outcome === "none") out.nothing++;
      else if (checked.outcome === "dropped") out.dropped++;
      else {
        await persist.applicationEvents.append([readingEvent(c, checked.reading)]);
        out.kept++;
      }
    }
    return out;
  } catch (err) {
    // A database error (a column not there yet, a failed write). What was already sent stays marked.
    return { ...out, status: out.sent > 0 ? "ran" : "skipped", why: `stopped: ${(err as Error).message?.split("\n")[0]?.slice(0, 120) || "unknown error"}` };
  }
}
