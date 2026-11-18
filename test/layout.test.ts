import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textFirst } from "@/lib/domain/comms";
import { templateDraft, thoughtDraft } from "@/lib/domain/drafts";
import { LAYOUT_BRIEF, LAYOUT_SINCE, MAIN_TABS, tabNotes, tabUsage, type TabUsage } from "@/lib/domain/layout";
import { dailyMentoring, type MentorInsight } from "@/lib/domain/mentor";
import { QA_AREA_LABEL, qaReview, type QaInput } from "@/lib/domain/qa";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

const USED: TabUsage = { today: { saved: 11, briefed: 9 }, growth: { given: 6, answered: 4 }, career: { queued: 3, decided: 2, waiting: 1 }, people: { due: 2, sent: 3 } };

describe("the layout the QA Agent keeps in mind", () => {
  it("records what the owner asked for: four tabs, each with one job", () => {
    expect(MAIN_TABS.map((t) => t.id)).toEqual(["today", "growth", "career", "people"]);
    for (const word of ["Today, Growth, Career, People", "Mentor", "Approval Queue", "texts", "never rearrange"]) expect(LAYOUT_BRIEF).toContain(word);
    expect(LAYOUT_SINCE).toBe("2026-11-17");
    const instructions = read("agents/qa/instructions.md");
    for (const word of ["Layout and workflow", "Growth", "Career", "People", "options to look into", "lib/domain/layout.ts"]) expect(instructions).toContain(word);
    // The review card shows it, before and after the first review.
    expect(read("components/QaCard.tsx")).toContain("{LAYOUT_BRIEF}");
  });

  it("calls a tab unused only when something was waiting in it", () => {
    expect(tabNotes(USED).every((t) => t.unused === null)).toBe(true);
    const quiet: TabUsage = { today: { saved: 2, briefed: 0 }, growth: { given: 2, answered: 0 }, career: { queued: 0, decided: 0, waiting: 0 }, people: { due: 2, sent: 0 } };
    expect(tabNotes(quiet).every((t) => t.unused === null)).toBe(true);
    const idle: TabUsage = { today: { saved: 11, briefed: 0 }, growth: { given: 6, answered: 0 }, career: { queued: 0, decided: 0, waiting: 2 }, people: { due: 5, sent: 0 } };
    const notes = tabNotes(idle);
    expect(notes.map((t) => t.tab)).toEqual(["today", "growth", "career", "people"]);
    for (const t of notes) {
      expect(t.unused, t.tab).not.toBeNull();
      // Options for the owner to choose from, never one instruction.
      expect(t.unused!.options).toMatch(/^Options to look into: .+; .+/);
    }
    expect(notes[3]!.unused!.title).toBe("People: 5 people are due a check-in and nothing was sent this week");
    expect(notes[3]!.line).toBe("People: 0 sent, 5 due a check-in");
  });

  it("counts a week of use from records, ignoring what is outside the week", () => {
    const u = tabUsage({
      from: "2026-11-23",
      since: "2026-11-23T07:00:00.000Z",
      briefsSaved: 3,
      briefsMarked: 5,
      insights: [
        { status: "done", forDate: "2026-11-24" },
        { status: "new", forDate: "2026-11-25" },
        { status: "replaced", forDate: "2026-11-25" },
        { status: "dismissed", forDate: "2026-11-20" },
      ],
      approvals: [
        { status: "pending", createdAt: "2026-11-24T15:00:00.000Z", decidedAt: null },
        { status: "approved", createdAt: "2026-11-18T15:00:00.000Z", decidedAt: "2026-11-25T15:00:00.000Z" },
        { status: "rejected", createdAt: "2026-11-10T15:00:00.000Z", decidedAt: "2026-11-12T15:00:00.000Z" },
      ],
      due: 4,
      handedOff: ["2026-11-26T18:00:00.000Z", "2026-11-20T18:00:00.000Z", null],
    });
    expect(u).toEqual({ today: { saved: 3, briefed: 3 }, growth: { given: 2, answered: 1 }, career: { queued: 1, decided: 1, waiting: 1 }, people: { due: 4, sent: 1 } });
  });
});

describe("the QA review's layout check", () => {
  const input = (today: string, usage: TabUsage | null | undefined, previous: QaInput["previous"] = null): QaInput => ({
    today,
    now: new Date(`${today}T23:00:00Z`),
    timeZone: "America/Denver",
    runs: [],
    briefs: [],
    connections: [],
    applications: [],
    approvals: [],
    insights: [],
    paused: [],
    aiCalls: [],
    aiDailyLimit: 60,
    aiOn: false,
    models: null,
    usage,
    previous,
  });
  const layout = (r: ReturnType<typeof qaReview>) => ({ check: r.checks.find((c) => c.area === "layout")!, findings: r.findings.filter((f) => f.area === "layout") });
  const idle: TabUsage = { ...USED, people: { due: 5, sent: 0 } };

  it("always says it looked, and passes when every tab was used", () => {
    const { check, findings } = layout(qaReview(input("2026-11-29", USED)));
    expect(check).toEqual({ area: "layout", name: "Each main tab was used", ok: true, note: "Today: 9 of 11 briefs marked Briefed · Growth: 4 of 6 Mentor insights answered · Career: 3 queued, 2 decided, 1 waiting · People: 3 sent, 2 due a check-in" });
    expect(findings).toEqual([]);
    expect(QA_AREA_LABEL.layout).toBe("Layout and workflow");
  });

  it("raises an unused tab as a low finding with options, and medium the third time running", () => {
    const first = layout(qaReview(input("2026-11-29", idle)));
    expect(first.check.ok).toBe(false);
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]).toMatchObject({ key: "layout:people", severity: "low", weeks: 1 });
    expect(first.findings[0]!.fix).toMatch(/^Options to look into: /);
    const third = layout(qaReview(input("2026-12-13", idle, { findings: [{ ...first.findings[0]!, weeks: 2 }] })));
    expect(third.findings[0]).toMatchObject({ key: "layout:people", severity: "medium", weeks: 3 });
  });

  it("does not judge the week the layout changed, or a week it could not count", () => {
    const changed = layout(qaReview(input("2026-11-22", idle)));
    expect(changed.findings).toEqual([]);
    expect(changed.check).toMatchObject({ ok: true, note: "The layout changed on Tue, Nov 17: the first full week is reviewed next" });
    for (const usage of [null, undefined]) {
      const none = layout(qaReview(input("2026-11-29", usage)));
      expect(none.findings).toEqual([]);
      expect(none.check).toMatchObject({ ok: true, note: "Use per tab was not counted this week" });
    }
  });
});

describe("Growth: daily mentoring", () => {
  const insight = (over: Partial<MentorInsight>): MentorInsight => ({ id: "i", forDate: "2026-11-18", slot: "morning", key: "k", area: "queue", title: "t", body: "b", action: "a", evidence: [], metric: "1", writer: "rules", status: "new", createdAt: "2026-11-18T16:00:00Z", ...over });

  it("shows today's three reviews in order: spoke, nothing to flag, still to come", () => {
    const day = dailyMentoring([insight({ id: "m1" }), insight({ id: "old", forDate: "2026-11-17", slot: "midday" })], "2026-11-18", "15:10");
    expect(day.map((d) => [d.slot, d.state, d.insights.map((i) => i.id)])).toEqual([
      ["morning", "spoke", ["m1"]],
      ["midday", "quiet", []],
      ["evening", "ahead", []],
    ]);
  });

  it("leaves out an insight a later review replaced, and keeps answered ones", () => {
    const day = dailyMentoring([insight({ id: "a", status: "replaced" }), insight({ id: "b", status: "done", createdAt: "2026-11-18T16:05:00Z" }), insight({ id: "c", createdAt: "2026-11-18T16:10:00Z" })], "2026-11-18", "09:30");
    expect(day[0]!.insights.map((i) => i.id)).toEqual(["c", "b"]);
  });

  it("leads the Growth page, which is a main tab of its own", () => {
    const page = read("app/(app)/growth/page.tsx");
    expect(page).toContain('title="Daily mentoring"');
    expect(page.indexOf('id="mentor"')).toBeLessThan(page.indexOf('id="projects"'));
    // Today's Mentor card still lands on it.
    expect(read("components/MentorCard.tsx")).toContain('href="/growth#mentor"');
  });
});

describe("People: sharing a thought by text", () => {
  const sam = { name: "Sam Rivera", circle: "friends" as const };

  it("keeps your words as you wrote them, with a greeting", () => {
    expect(thoughtDraft(sam, "I keep thinking about that trail. Want to plan it?", "sms", "Tyler")).toEqual({ subject: "", body: "Hey Sam, I keep thinking about that trail. Want to plan it?" });
    // A check-in draft rewrites the purpose; a thought is never rewritten.
    expect(templateDraft(sam, "I keep thinking about that trail", "sms", "Tyler").body).toBe("Hey Sam, i keep thinking about that trail. – Tyler");
    const mail = thoughtDraft({ name: "Dana Lee", circle: "network" }, "An idea for your launch.\nShip the small version first.", "email", "Tyler");
    expect(mail.subject).toBe("An idea for your launch.");
    expect(mail.body).toBe("Hi Dana,\n\nAn idea for your launch.\nShip the small version first.\n\nThanks,\nTyler");
    expect(thoughtDraft(sam, "x".repeat(900), "sms", "Tyler").body.length).toBe(640);
  });

  it("goes by text whenever the person has a phone number", () => {
    expect(textFirst({ email: "a@example.com", phone: "+13035550101", circle: "team", slackTeamId: "T012AB", slackUserId: "U012AB" }, "slack")).toBe("sms");
    expect(textFirst({ email: "a@example.com", phone: null, circle: "friends" })).toBe("email");
    expect(textFirst({ email: null, phone: null, circle: "friends" })).toBeNull();
  });

  it("is Semi-Automation: Atlas drafts, the owner opens and sends each one", () => {
    const share = read("components/client/PeopleCompose.tsx");
    expect(share).toContain('title="Share a thought or idea"');
    expect(share).toContain('mode="share"');
    // Nothing here sends or calls a server action: the composer hands each draft to the owner's own app.
    expect(share).not.toMatch(/app\/actions|fetch\(/);
    expect(read("components/client/Composer.tsx")).toContain("Atlas never sends on its own.");
    expect(read("app/(app)/people/page.tsx")).toContain("<PeopleCompose");
  });
});
