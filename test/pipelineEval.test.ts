import { describe, expect, it } from "vitest";
import { mailReaderTask, MailReadingOut } from "@/lib/ai/prompts";
import { READER_DAILY_CAP, type RawReading } from "@/lib/domain/mailReader";
import { pct } from "@/lib/evals";
import { cascadeKind, payloadFor, PIPELINE_MAILS, pipelineSuite, rulesKind, scorePipeline, undecided, type PipelineKind, type PipelineMail, type PipelineScore } from "@/lib/evals/suites/pipeline";

// The Pipeline's eval: rules alone against rules plus the model (docs/design-pipeline.md,
// section 6). `npm run evals:pipeline` prints the table.
//
// Rules alone run here on every pull request, with the hard bar: no email called an
// interview or an offer that is not one. The model in these tests is a stand-in, so CI
// never reaches a provider.
//
// The live run is opt-in and sends only the made-up emails in lib/evals/suites/pipeline.ts:
//   ATLAS_PIPELINE_EVAL=live GEMINI_API_KEY=... npm run evals:pipeline
// It makes at most 12 model calls (the reader's daily cap), the emails rules get wrong
// first; ATLAS_PIPELINE_EVAL_SKIP=12 continues with the next 12 on another day. A local
// run has no database, so these calls are not in Atlas's own count: run it at most once a
// day, and count its 12 against that day's 60.

const row = (name: string, s: PipelineScore) => ({
  reader: name,
  kind: `${s.kindRight}/${s.total} (${pct(s.kindRight / s.total)})`,
  "false interview or offer": s.falseGoodNews.length,
  matching: `${s.matchRight}/${s.matchTotal} (${pct(s.matchRight / s.matchTotal)})`,
});

const STAGE_OF: Record<Exclude<PipelineKind, "none">, RawReading["stage"]> = { rejection: "rejected", offer: "offer", interview: "interview", assessment: "assessment", scheduling: "in_review", info_request: "in_review", reply: "in_review", confirmation: "applied" };
const firstSentence = (m: PipelineMail) =>
  payloadFor(m)
    .sent.split(/\n|(?<=[.!?])\s+/)
    .find((s) => s.trim().split(" ").length >= 4)
    ?.trim() ?? "";
/** A stand-in model that says `kind` and rests it on a sentence. Where the email would not move the stage, it repeats the stage, as the prompt asks. */
const answer = (m: PipelineMail, kind: PipelineKind, sentence: string): RawReading => {
  if (kind === "none") return { kind, stage: "applied", role: "", ask: "", deadline: "", people: [], sentence: "" };
  const interviewing = JSON.parse(payloadFor(m).data).application.stageNow === "interview";
  const lower = ["in_review", "applied"].includes(STAGE_OF[kind]);
  return { kind, stage: interviewing && lower ? "interview" : STAGE_OF[kind], role: "", ask: "", deadline: "", people: [], sentence };
};

describe("Pipeline eval: rules alone", () => {
  const rules = scorePipeline(rulesKind);

  it("is about 60 made-up emails, each with the kind a person would give it", () => {
    expect(PIPELINE_MAILS.length).toBeGreaterThanOrEqual(58);
    expect(new Set(PIPELINE_MAILS.map((m) => m.id)).size).toBe(PIPELINE_MAILS.length);
    // Made up: only the invented companies' domains, and no address inside any text.
    for (const m of PIPELINE_MAILS) {
      expect(m.fromEmail, m.id).toMatch(/@(acmerobotics\.com|borealis\.com|cobalt\.greenhouse\.io|duneanalytics\.com|fathomlabs\.com|everline\.greenhouse\.io)$/);
      expect(m.text, m.id).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
    const kinds = new Set(PIPELINE_MAILS.map((m) => m.kind));
    for (const k of ["rejection", "offer", "interview", "assessment", "scheduling", "info_request", "reply", "confirmation", "none"]) expect(kinds.has(k as PipelineKind), k).toBe(true);
  });

  it("never calls an email an interview or an offer that is not one (the hard bar)", () => {
    expect(rules.falseGoodNews).toEqual([]);
  });

  it("a subject alone never makes an interview or an offer once the text is read", () => {
    // What the text left undecided is never good news, whatever the subject says.
    for (const m of PIPELINE_MAILS.filter(undecided)) expect(["interview", "offer"], m.id).not.toContain(rulesKind(m));
    // The eval holds such emails: a confirmation, a reply and a real invite under "next steps" or "interview".
    const tempting = PIPELINE_MAILS.filter((m) => undecided(m) && /\b(interview|next steps)\b/i.test(m.subject));
    expect(new Set(tempting.map((m) => m.kind))).toEqual(new Set(["confirmation", "reply", "interview"]));
    // And an invite under "Next steps" is still one when its text says so.
    const said = PIPELINE_MAILS.find((m) => m.subject === "Next steps")!;
    expect([said.kind, rulesKind(said), undecided(said)]).toEqual(["interview", "interview", false]);
  });

  it("prints rules alone", () => {
    console.table([row("rules alone", rules)]);
    console.log(`Rules left ${rules.undecided} of ${rules.total} texts undecided; ${PIPELINE_MAILS.filter((m) => m.gap).length} of those are emails rules get wrong (the model reader's to read).`);
    expect(rules.kindRight / rules.total).toBeGreaterThanOrEqual(0.75);
    expect(rules.matchRight / rules.matchTotal).toBeGreaterThanOrEqual(0.95);
    expect(pipelineSuite.cases).toHaveLength(rules.total + rules.matchTotal);
  });

  it("every email rules get wrong is one whose text they left undecided", () => {
    // So the cascade can reach every one of them: none is a wrong answer the model never sees.
    for (const m of PIPELINE_MAILS.filter((x) => rulesKind(x) !== x.kind)) expect(undecided(m), m.id).toBe(true);
  });
});

describe("Pipeline eval: rules plus a stand-in model", () => {
  const rules = scorePipeline(rulesKind);

  it("a model that reads every email right brings the score to all of them, with the bar kept", () => {
    const perfect = scorePipeline((m) => cascadeKind(m, answer(m, m.kind, firstSentence(m))));
    console.table([row("rules alone", rules), row("rules + a perfect stand-in", perfect)]);
    expect(perfect.kindRight).toBe(perfect.total);
    expect(perfect.falseGoodNews).toEqual([]);
    // Matching is the ladder's: the model never picks an application.
    expect([perfect.matchRight, perfect.matchTotal]).toEqual([rules.matchRight, rules.matchTotal]);
  });

  it("a model is only heard where rules decided nothing", () => {
    const loud = scorePipeline((m) => cascadeKind(m, answer(m, "rejection", firstSentence(m))));
    for (const m of PIPELINE_MAILS.filter((x) => !undecided(x))) expect(cascadeKind(m, answer(m, "rejection", firstSentence(m))), m.id).toBe(rulesKind(m));
    expect(loud.falseGoodNews).toEqual([]);
  });

  it("a model that invents its sentence changes nothing: every reading is dropped", () => {
    const liar = scorePipeline((m) => cascadeKind(m, answer(m, "offer", "We are delighted to offer you the job, starting Monday.")));
    expect(liar).toEqual(rules);
  });

  it("a model that quotes a real sentence can still be wrong, which is why a reading is only ever a suggestion", () => {
    // The checks prove the sentence is in the email, not that it means an offer. Nothing in
    // code can: so the model never moves a stage (5.6), and the bar is measured, here and in shadow.
    const confident = scorePipeline((m) => cascadeKind(m, answer(m, "offer", firstSentence(m))));
    expect(confident.falseGoodNews.length).toBeGreaterThan(0);
  });
});

const LIVE = process.env.ATLAS_PIPELINE_EVAL === "live";

describe.skipIf(!LIVE)("Pipeline eval: rules plus the live model (opt-in)", () => {
  it(
    "asks the model about made-up emails rules left undecided, within the day's reader cap",
    async () => {
      const { aiConfigured, structured } = await import("@/lib/ai/model");
      if (!aiConfigured()) throw new Error("Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) to run the live eval.");
      const skip = Math.max(0, Number(process.env.ATLAS_PIPELINE_EVAL_SKIP ?? 0) || 0);
      // The emails rules get wrong first, then the ones a model must not be fooled by.
      const todo = PIPELINE_MAILS.filter(undecided).sort((a, b) => Number(Boolean(b.gap)) - Number(Boolean(a.gap)));
      const batch = todo.slice(skip, skip + READER_DAILY_CAP);
      const readings = new Map<string, RawReading | null>();
      for (const [i, m] of batch.entries()) {
        // Under ten calls a minute, as Atlas's own burst limit asks.
        if (i > 0) await new Promise((r) => setTimeout(r, 6_500));
        const res = await structured(MailReadingOut, mailReaderTask(), payloadFor(m).data, { tier: "fast", effort: "low" });
        readings.set(m.id, res.ok ? res.value : null);
      }
      const kindOf = (m: PipelineMail) => (readings.has(m.id) ? cascadeKind(m, readings.get(m.id) ?? null) : rulesKind(m));
      const live = scorePipeline(kindOf);
      console.table([row("rules alone", scorePipeline(rulesKind)), row(`rules + live model (${batch.length} of ${todo.length} undecided asked)`, live)]);
      console.table(batch.map((m) => ({ id: m.id, is: m.kind, rules: rulesKind(m), model: readings.get(m.id)?.kind ?? "no answer", "after checks": kindOf(m), right: kindOf(m) === m.kind ? "yes" : "NO" })));
      expect(batch.length).toBeLessThanOrEqual(READER_DAILY_CAP);
      expect(live.falseGoodNews).toEqual([]);
    },
    240_000,
  );
});
