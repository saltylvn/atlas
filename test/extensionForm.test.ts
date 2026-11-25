import { describe, expect, it } from "vitest";
import { answerForm, EXTENSION_TASK } from "@/lib/agents/extensionAnswers";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { acceptPicks, bankIdFor, draftable, forModel, FORMS_PER_DAY, FormRequest, keyHash, keyMatches, KEY_PREFIX, ownerFacts, takeForm } from "@/lib/domain/extensionForm";
import { isPublicPath } from "@/lib/supabase/gate";

const NOW = new Date("2026-11-20T17:00:00Z");
const TODAY = "2026-11-20";
const KEY = `${KEY_PREFIX}${"a".repeat(43)}`;
const q = (id: string, label: string, kind: FormRequest["questions"][number]["kind"] = "text", options: string[] = [], required = true) => ({ id, label, kind, options, required });

describe("The extension's key", () => {
  const stored = { hash: keyHash(KEY), prefix: "atlas_ext_aaaa…", createdAt: NOW.toISOString() };

  it("matches only the key whose hash is stored, as a bearer token", () => {
    expect(keyMatches(`Bearer ${KEY}`, stored)).toBe(true);
    expect(keyMatches(`Bearer ${KEY}x`, stored)).toBe(false);
    expect(keyMatches(KEY, stored)).toBe(false);
    expect(keyMatches(`Bearer ${KEY}`, undefined)).toBe(false);
    expect(keyMatches(null, stored)).toBe(false);
    // Something that is not an Atlas Autofill key is refused before hashing.
    expect(keyMatches("Bearer sk-live-something-else-entirely-long-enough", stored)).toBe(false);
  });

  it("keeps only a fingerprint: the key itself is never stored", () => {
    expect(stored.hash).toHaveLength(64);
    expect(stored.hash).not.toContain(KEY.slice(KEY_PREFIX.length, KEY_PREFIX.length + 10));
  });

  it("lets the extension's routes past the browser-session gate, which then check the key themselves", () => {
    expect(isPublicPath("/api/extension/answers")).toBe(true);
    expect(isPublicPath("/api/extensions")).toBe(false);
    expect(isPublicPath("/api/export")).toBe(false);
  });
});

describe("What the extension may send", () => {
  it("accepts a form's questions and refuses anything else", () => {
    const ok = FormRequest.safeParse({ url: "https://jobs.example/apply", questions: [q("f0_q1", "First Name")] });
    expect(ok.success).toBe(true);
    expect(FormRequest.safeParse({ url: "javascript:alert(1)", questions: [q("f0_q1", "x")] }).success).toBe(false);
    expect(FormRequest.safeParse({ url: "https://x.test", questions: [] }).success).toBe(false);
    expect(FormRequest.safeParse({ url: "https://x.test", questions: [q("../etc", "x")] }).success).toBe(false);
    expect(FormRequest.safeParse({ url: "https://x.test", questions: Array.from({ length: 81 }, (_, i) => q(`f0_q${i}`, "x")) }).success).toBe(false);
  });
});

describe("Which questions Gemini may touch", () => {
  const questions = [
    q("a", "How many years of professional experience do you have?", "select", ["0", "1", "2", "3"]),
    q("b", "I agree to receive text messages from the company", "select", ["Yes", "No"]),
    q("c", "What is your desired salary?", "select", ["$80k", "$100k"]),
    q("d", "Are you comfortable relocating to Austin?", "select", ["Yes", "No"]),
    q("e", "Have you shipped an LLM system into production?", "select", ["Yes", "No"]),
    q("f", "Tell us about a hard problem you solved", "textarea"),
    q("g", "Do you consent to the privacy policy?", "textarea"),
  ];
  const answers = questions.map((x) => ({ id: x.id, value: "", source: (x.kind === "textarea" ? "ai" : "none") as "ai" | "none", why: "" }));

  it("never consent, money, relocation or commute questions", () => {
    expect(forModel(questions, answers).map((x) => x.id)).toEqual(["a", "e"]);
    expect(draftable(questions, answers).map((x) => x.id)).toEqual(["f"]);
  });

  it("keeps only picks that are the form's own options, single where single, and cited", () => {
    const asked = forModel(questions, answers);
    const kept = acceptPicks(
      {
        picks: [
          { id: "a", choose: ["2"], cites: ["years"], why: "Your years fact says 2." },
          { id: "e", choose: ["Yes"], cites: [], why: "Probably." },
          { id: "b", choose: ["Yes"], cites: ["1"], why: "Not asked." },
        ],
      },
      asked,
      new Set(["years", "1"]),
    );
    expect(kept).toEqual([{ id: "a", value: "2", source: "ai", why: "Gemini: Your years fact says 2." }]);
    expect(acceptPicks({ picks: [{ id: "a", choose: ["2 years"], cites: ["years"], why: "x" }] }, asked, new Set(["years"]))).toEqual([]);
    expect(acceptPicks({ picks: [{ id: "a", choose: ["1", "2"], cites: ["years"], why: "x" }] }, asked, new Set(["years"]))).toEqual([]);
  });

  it("caps the forms answered with Gemini each day", () => {
    expect(takeForm(undefined, TODAY)).toEqual({ day: TODAY, forms: 1 });
    expect(takeForm({ day: TODAY, forms: FORMS_PER_DAY }, TODAY)).toBeNull();
    expect(takeForm({ day: "2026-11-19", forms: FORMS_PER_DAY }, TODAY)).toEqual({ day: TODAY, forms: 1 });
  });

  it("offers to save a correction only to answer-bank questions a form cannot spoil", () => {
    expect(bankIdFor("Tell us about yourself", "textarea")).toBe("intro");
    expect(bankIdFor("Desired salary", "text")).toBe("salary");
    expect(bankIdFor("Why do you want to work at Acme?", "textarea")).toBeUndefined();
    expect(bankIdFor("LinkedIn URL", "text")).toBeUndefined();
    expect(bankIdFor("Years of experience", "select")).toBeUndefined();
  });

  it("gives the model only facts you wrote, each with a name it can cite", () => {
    expect(ownerFacts({ careerAnswers: { yearsExperience: "2", city: "Salt Lake City, UT", email: "x@example.com" }, careerSkills: ["Python", "RAG"] }, ["AI Engineer"])).toEqual({ years: "2", city: "Salt Lake City, UT", skills: "Python, RAG", roles: "AI Engineer" });
  });
});

describe("The Apply bot answers a form for the extension", () => {
  function demo(): Context {
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    const settings = { ...state.settings, careerAnswers: { fullName: "Sam Rivera", email: "sam@example.com", yearsExperience: "2", heardFrom: "Firecrawl" }, careerEligibility: { authorized: "yes" as const, sponsorship: "no" as const, workedHere: "no" as const, gender: "male" as const } };
    state.settings = settings;
    return { mode: "demo", userId: "demo", store, settings, now: NOW, today: TODAY, time: "10:00" };
  }
  const form: FormRequest = {
    url: "https://talent.example/jobs/1/apply",
    title: "Forward Deployed Engineer",
    posting: "",
    company: "Example",
    role: "Forward Deployed Engineer",
    resume: "AI Engineer",
    questions: [
      q("f0_q1", "First Name"),
      q("f0_q2", "Email"),
      q("f0_q3", "Resume/CV", "file"),
      q("f0_q4", "Are you legally authorized to work in the country where you are applying?", "select", ["Yes", "No"]),
      q("f0_q5", "Gender", "select", ["Female", "Male", "Decline to self identify"], false),
      q("f0_q6", "Race", "select", ["Asian", "White", "Decline to self identify"], false),
      q("f0_q7", "How many years of professional experience do you have?", "select", ["0", "1", "2", "3"]),
      q("f0_q8", "I agree to receive text messages", "select", ["Yes"]),
      q("f0_q9", "Tell us about a project you led", "textarea"),
      q("f0_q10", "Have you shipped an LLM system into production?", "select", ["Yes", "No"]),
    ],
  };

  it("answers from your bank and Setup first, then Gemini, and leaves what is yours", async () => {
    const ctx = demo();
    const out = await answerForm(ctx, ctx.store, form, {
      pick: async (input) => ({ out: { picks: input.questions.map((x) => ({ id: x.id, choose: ["Yes"], cites: ["1"], why: "Passage 1 says you shipped one." })) }, usage: null, why: "" }),
      draft: async () => ({ text: "I led the build of an internal agent platform.", cited: 2, why: "", usage: null }),
    });
    const a = (id: string) => out.answers.find((x) => x.id === id)!;
    expect(a("f0_q1")).toMatchObject({ value: "Sam", source: "bank" });
    expect(a("f0_q2")).toMatchObject({ value: "sam@example.com", source: "bank" });
    expect(a("f0_q3")).toMatchObject({ source: "resume" });
    expect(a("f0_q4")).toMatchObject({ value: "Yes", source: "eligibility" });
    expect(a("f0_q5")).toMatchObject({ value: "Male", source: "eligibility" });
    expect(a("f0_q6")).toMatchObject({ value: "Decline to self identify", source: "none", yours: "A question Atlas never answers for you" });
    // Your years in the answer bank is one of the form's options, word for word: the rule answers it, not Gemini.
    expect(a("f0_q7")).toMatchObject({ value: "2", source: "bank" });
    expect(a("f0_q8").value).toBe("");
    expect(a("f0_q9")).toMatchObject({ value: "I led the build of an internal agent platform.", source: "ai" });
    // The demo has no resume passages, so a pick citing passage 1 cites nothing it was given: it is dropped, and the question stays yours.
    expect(a("f0_q10")).toMatchObject({ value: "", yours: "Your resume and facts do not decide this one" });
    // One form counted against the day's cap, and one run logged under the Apply Agent with counts only.
    expect(ctx.store).toBeDefined();
    expect((await ctx.store.settings.get()).extensionUsage).toEqual({ day: TODAY, forms: 1 });
    const run = (await ctx.store.agentRuns.recent(5)).find((r) => r.task === EXTENSION_TASK && r.status === "succeeded")!;
    expect(run).toMatchObject({ agent: "apply", trigger: "owner" });
    expect(run.detail).toMatch(/^talent\.example: \d+ of 10 answered/);
    expect(run.detail).not.toContain("Sam");
  });

  it("asks no model when the rules answer everything, and none past the day's cap", async () => {
    const ctx = demo();
    let asked = 0;
    const deps = { pick: async () => ((asked++), { out: null, usage: null, why: "" }), draft: async () => ((asked++), { text: "", cited: 0, why: "", usage: null }) };
    await answerForm(ctx, ctx.store, { ...form, questions: form.questions.slice(0, 5) }, deps);
    expect(asked).toBe(0);
    ctx.settings.extensionUsage = { day: TODAY, forms: FORMS_PER_DAY };
    const out = await answerForm(ctx, ctx.store, form, deps);
    expect(asked).toBe(0);
    expect(out.notes[0]).toContain(`${FORMS_PER_DAY} forms with Gemini today`);
  });
});
