import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { ROLE_NOT_LISTED, type MailToPlace } from "@/lib/domain/applications";
import { feedSplit, FEED_SHOWN } from "@/lib/domain/heardBack";
import { STAGE_HUE } from "@/lib/domain/pipeline";
import { byCompany, byStage, filterCounts, filterRows, FILTERS, needsYou, pick, pipelineRows, pipelineStats, QUIET_AFTER_DAYS, STAGE_ORDER, VIEWS, type ListedEvent } from "@/lib/domain/pipelineList";
import { APPLICATION_STAGES, type Application } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-21T16:00:00Z");
/** `days` (and `hours`) before NOW, as the database writes a time. */
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();

const app = (id: string, over: Partial<Application> = {}): Application => ({
  id,
  company: "Acme",
  role: "AI Engineer",
  targetRole: "",
  source: "Email",
  url: "",
  payText: "",
  tier: "semi",
  status: "applied",
  appliedOn: ago(3).slice(0, 10),
  statusAt: ago(3),
  notes: "",
  origin: "atlas",
  externalId: `email:${id}`,
  createdAt: ago(3),
  ...over,
});
const event = (applicationId: string, kind: ListedEvent["kind"], occurredAt: string, over: Partial<ListedEvent> = {}): ListedEvent => ({ applicationId, kind, occurredAt, source: "email", decidedBy: "rules", stage: null, summary: "", ...over });
const rowsOf = (apps: Application[], events: ListedEvent[] = [], notices: { applicationId: string; seenAt: string | null }[] = []) => pipelineRows(apps, events, notices, NOW);
const one = (a: Application, events: ListedEvent[] = [], notices: { applicationId: string; seenAt: string | null }[] = []) => rowsOf([a], events, notices)[0]!;

describe("A row on the Pipeline", () => {
  it("says the stage, the newest thing on the timeline, when they last wrote and what is unread", () => {
    const a = app("a1", { status: "interview", stage: "screen", statusAt: ago(0, 2), lastHeardAt: ago(0, 2) });
    const r = one(
      a,
      [event("a1", "applied", ago(9), { source: "you", decidedBy: "you", summary: "You applied" }), event("a1", "screen", ago(0, 2), { summary: "We would like to set up a call" }), event("other", "offer", ago(0, 1))],
      [
        { applicationId: "a1", seenAt: null },
        { applicationId: "a1", seenAt: ago(1) },
        { applicationId: "other", seenAt: null },
      ],
    );
    expect(r).toEqual({ id: "a1", company: "Acme", role: "AI Engineer", stage: "screen", state: "active", latest: { kind: "screen", title: "Screen", at: ago(0, 2) }, lastHeardAt: ago(0, 2), quietDays: null, reached: null, unread: 1, activeAt: ago(0, 2) });
  });

  it("names an email by its kind and your own move by what you did, never by an email's words", () => {
    const mail = one(app("a1"), [event("a1", "rejection", ago(1), { summary: "After careful consideration we will not move forward" })]);
    expect(mail.latest?.title).toBe("Rejection");
    const yours = one(app("a1"), [event("a1", "stage_set", ago(1), { source: "you", decidedBy: "you", stage: "interview", summary: "You moved it to Interview" })]);
    expect(yours.latest?.title).toBe("You moved it to Interview");
    expect(one(app("a1")).latest).toBeNull();
  });

  it("reads the stage with stageOf, so a stale stored stage never shows", () => {
    expect(one(app("a1", { status: "rejected", stage: "screen" })).stage).toBe("rejected");
    expect(one(app("a1", { status: "replied" })).stage).toBe("in_review");
  });

  it("leaves the role empty while no email has named it", () => {
    expect(one(app("a1", { role: ROLE_NOT_LISTED })).role).toBe("");
  });

  it("is quiet after a week with no news, counted from their last email or the last move", () => {
    expect(QUIET_AFTER_DAYS).toBe(7);
    const applied = (days: number, over: Partial<Application> = {}) => one(app("a1", { statusAt: ago(days), appliedOn: ago(days).slice(0, 10), ...over }));
    expect([applied(6, {}).state, applied(6).quietDays]).toEqual(["active", null]);
    expect([applied(7).state, applied(7).quietDays]).toEqual(["quiet", 7]);
    expect([applied(9).state, applied(9).quietDays]).toEqual(["quiet", 9]);
    // They wrote since: the count starts again from that email.
    expect(applied(30, { status: "replied", lastHeardAt: ago(2) }).state).toBe("active");
    expect(applied(30, { status: "replied", lastHeardAt: ago(12) }).quietDays).toBe(12);
  });

  it("stays quiet after your own follow-up: that is you writing, not them", () => {
    const r = one(app("a1", { statusAt: ago(10), appliedOn: ago(10).slice(0, 10) }), [event("a1", "follow_up", ago(1), { source: "you", decidedBy: "you", summary: "You followed up" })]);
    expect([r.state, r.quietDays, r.latest?.title]).toEqual(["quiet", 10, "You followed up"]);
    // It still rises in the list: something happened on it yesterday.
    expect(r.activeAt).toBe(ago(1));
  });

  it("is never quiet before it is sent or after it is over", () => {
    expect(one(app("a1", { status: "saved", appliedOn: null, statusAt: ago(40) })).state).toBe("active");
    expect(one(app("a1", { status: "rejected", statusAt: ago(40) })).state).toBe("closed");
    expect(one(app("a1", { status: "rejected", stage: "withdrawn", statusAt: ago(40) })).state).toBe("closed");
  });

  it("says how far a closed application got, in the application page's own words", () => {
    const events = [event("a1", "applied", ago(20), { source: "you", decidedBy: "you" }), event("a1", "screen", ago(10)), event("a1", "rejection", ago(2))];
    expect(one(app("a1", { status: "rejected", statusAt: ago(2) }), events).reached).toBe("Screen");
    // Rejected with nothing in between: it got as far as Applied.
    expect(one(app("a1", { status: "rejected", statusAt: ago(2) }), [event("a1", "rejection", ago(2))]).reached).toBe("Applied");
    expect(one(app("a1"), events.slice(0, 2)).reached).toBeNull();
  });

  it("lists newest activity first, whatever format the times are stored in", () => {
    const rows = rowsOf(
      [app("old", { statusAt: ago(5) }), app("new", { statusAt: ago(9) }), app("mid", { statusAt: ago(2) })],
      // Postgres writes "+00:00" where JavaScript writes "Z": the same instant must sort the same.
      [event("new", "reply", ago(0, 1).replace("Z", "+00:00"))],
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("Filters and groups", () => {
  const apps = [
    app("offer", { company: "Delta", status: "offer", statusAt: ago(1), lastHeardAt: ago(1) }),
    app("screen", { company: "Beta", role: "Solutions Engineer", status: "interview", stage: "screen", statusAt: ago(2), lastHeardAt: ago(2) }),
    app("beta-2", { company: "Beta Inc", role: "Sales Engineer", statusAt: ago(4) }),
    app("quiet", { company: "Corvid", statusAt: ago(9) }),
    app("saved", { company: "Echo", status: "saved", appliedOn: null, statusAt: ago(5) }),
    app("no", { company: "Fox", status: "rejected", statusAt: ago(3), lastHeardAt: ago(3) }),
  ];
  const rows = rowsOf(apps, [], [
    { applicationId: "screen", seenAt: null },
    { applicationId: "beta-2", seenAt: null },
  ]);

  it("every application is in exactly one of Active, Quiet and Closed", () => {
    const counts = filterCounts(rows);
    expect(counts).toEqual({ all: 6, active: 4, quiet: 1, closed: 1 });
    expect(counts.active + counts.quiet + counts.closed).toBe(counts.all);
    for (const f of FILTERS) expect(filterRows(rows, f)).toHaveLength(counts[f]);
    expect(filterRows(rows, "quiet").map((r) => r.id)).toEqual(["quiet"]);
    expect(filterRows(rows, "closed").map((r) => r.id)).toEqual(["no"]);
  });

  it("By stage: furthest along first, what is over last, and no empty stage", () => {
    expect([...STAGE_ORDER].sort()).toEqual([...APPLICATION_STAGES].sort());
    const groups = byStage(rows);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id), g.closed])).toEqual([
      ["Offer", ["offer"], false],
      ["Screen", ["screen"], false],
      ["Applied", ["beta-2", "quiet"], false],
      ["To submit", ["saved"], false],
      ["Rejected", ["no"], true],
    ]);
    // Every stage has a hue for its badge.
    for (const s of APPLICATION_STAGES) expect(STAGE_HUE[s]).toMatch(/^var\(--c-[a-z]+\)$/);
  });

  it("By company: two roles at one company are one group of two, under either spelling", () => {
    const groups = byCompany(rows);
    expect(groups.map((g) => [g.company, g.rows.map((r) => r.id), g.unread])).toEqual([
      ["Delta", ["offer"], 0],
      ["Beta", ["screen", "beta-2"], 2],
      ["Fox", ["no"], 0],
      ["Echo", ["saved"], 0],
      ["Corvid", ["quiet"], 0],
    ]);
  });

  it("counts what was sent and what got any answer", () => {
    expect(pipelineStats(apps)).toEqual({ sent: 5, answered: 3, rate: 60 });
    expect(pipelineStats([])).toEqual({ sent: 0, answered: 0, rate: 0 });
  });

  it("takes a filter or view from a link only when it is one it knows", () => {
    expect([pick(FILTERS, "quiet"), pick(FILTERS, undefined), pick(FILTERS, "<script>")]).toEqual(["quiet", "all", "all"]);
    expect([pick(VIEWS, "company"), pick(VIEWS, "board"), pick(VIEWS, "kanban")]).toEqual(["company", "board", "stage"]);
  });
});

describe("Needs you", () => {
  const mail = (messageId: string, receivedAt: string): MailToPlace => ({ messageId, company: "Beta", kind: "Interview invite", subject: "Next steps", receivedAt, choices: [{ id: "b1", role: "Solutions Engineer", stage: "Screen" }, { id: "b2", role: "Sales Engineer", stage: "Applied" }] });

  it("lists emails to place first, newest first, then roles to fill in, newest application first", () => {
    const apps = [app("named"), app("older", { role: ROLE_NOT_LISTED, appliedOn: "2026-11-10" }), app("newer", { role: ROLE_NOT_LISTED, appliedOn: "2026-11-19" })];
    const lane = needsYou([mail("m-old", ago(3)), mail("m-new", ago(1))], apps);
    expect(lane.map((i) => i.key)).toEqual(["place:m-new", "place:m-old", "role:newer", "role:older"]);
    expect(lane.map((i) => i.kind)).toEqual(["place", "place", "role", "role"]);
  });

  it("is empty when nothing waits on you", () => {
    expect(needsYou([], [app("a1"), app("a2", { status: "rejected" })])).toEqual([]);
  });

  it("asks only what the design lists for this phase: no next step and no model reading yet", () => {
    const source = read("lib/domain/pipelineList.ts");
    expect(source).toContain('export type NeedsYou = { kind: "place"; key: string; mail: MailToPlace } | { kind: "role"; key: string; app: Unnamed };');
    expect(source).not.toMatch(/takeAiCall|lib\/ai|fetch\(/);
  });
});

describe("Heard back on the Pipeline", () => {
  const notice = (id: string, seen: boolean) => ({ id, seenAt: seen ? ago(1) : null });

  it("shows what is new on top and folds the rest, in feed order", () => {
    const rows = [notice("a", true), notice("b", false), notice("c", true), notice("d", false)];
    expect(feedSplit(rows)).toEqual({ top: [rows[1], rows[3]], rest: [rows[0], rows[2]] });
  });

  it("is one line when nothing is unread, and never shows more than six on top", () => {
    const read = [notice("a", true), notice("b", true)];
    expect(feedSplit(read)).toEqual({ top: [], rest: read });
    const many = Array.from({ length: FEED_SHOWN + 3 }, (_, i) => notice(`n${i}`, false));
    const split = feedSplit(many);
    expect(split.top.map((r) => r.id)).toEqual(many.slice(0, FEED_SHOWN).map((r) => r.id));
    expect(split.rest).toHaveLength(3);
    expect(feedSplit([])).toEqual({ top: [], rest: [] });
  });
});

describe("The Pipeline page", () => {
  const page = read("app/(app)/(career)/applications/page.tsx");

  it("reads through getContext and the store, never a database client", () => {
    expect(page).toContain("await getContext()");
    expect(page).toContain("store.applicationEvents.listed()");
    expect(page).not.toMatch(/supabase|createClient|"use client"/);
    expect(read("components/Pipeline.tsx")).not.toMatch(/supabase|createClient|"use client"|getContext/);
  });

  it("puts Needs you on top, then Heard back, then the list", () => {
    const lane = page.indexOf("<NeedsYouLane");
    const feed = page.indexOf('<section id="heard-back"');
    const list = page.indexOf("<StageList");
    expect(lane).toBeGreaterThan(page.indexOf("<PageHeader"));
    expect(feed).toBeGreaterThan(lane);
    expect(list).toBeGreaterThan(feed);
    // The question about an email is asked in the lane, with the same buttons and the same server action.
    expect(page).toContain("needsYou(toPlace, apps)");
    expect(page).not.toContain('id="emails-to-place"');
    expect(page).not.toContain('id="roles-to-fill"');
    const parts = read("components/Pipeline.tsx");
    expect(parts).toContain("<PlaceMailButtons messageId={item.mail.messageId} company={item.mail.company} choices={item.mail.choices} />");
    expect(parts).toContain("<ApplicationRoleForm id={item.app.id} company={item.app.company} roles={roles} />");
  });

  it("opens each application's own page from its row, and offers the board on a wide screen only", () => {
    const parts = read("components/Pipeline.tsx");
    expect(parts).toContain("<Link href={`/applications/${r.id}`} className=\"flex min-h-[44px]");
    expect(page).toContain('v === "board" ? "hidden lg:inline-flex" : ""');
  });

  it("moved the answer bank and Autofill to Setup, with every link to them", () => {
    expect(page).not.toMatch(/AnswerBankForm|atlas-autofill-data/);
    const setup = read("app/(app)/(career)/career/setup/page.tsx");
    expect(setup).toContain('<section id="answers"');
    expect(setup).toContain('<section id="autofill"');
    // The Safari extension reads these two ids on any page it runs on; Setup is under /career.
    expect(setup).toContain('id="atlas-autofill-data"');
    expect(setup).toContain('id="atlas-autofill-status"');
    expect(JSON.parse(read("extension/safari/manifest.json")).content_scripts[0].matches).toContain("https://atlas-optim.vercel.app/career*");
    for (const f of ["components/ApprovalQueue.tsx", "app/(app)/(career)/roles/page.tsx", "app/(app)/(career)/career/setup/page.tsx", "app/(app)/(career)/career/page.tsx"]) expect(read(f)).not.toMatch(/\/applications#(answers|autofill)/);
    expect(read("app/actions/career.ts")).toContain('revalidatePath("/career/setup");');
  });

  it("the store lists every event for the page without email ids or threads", async () => {
    const state = seedState(NOW, "America/Denver");
    const store = createMemoryStore(state);
    const listed = await store.applicationEvents.listed();
    expect(listed).toHaveLength(state.applicationEvents!.length);
    expect(Object.keys(listed[0]!).sort()).toEqual(["applicationId", "decidedBy", "kind", "occurredAt", "source", "stage", "summary"]);
    expect(listed.map((e) => e.occurredAt)).toEqual([...listed.map((e) => e.occurredAt)].sort().reverse());
    expect(read("lib/data/supabase.ts")).toContain('.select("application_id, kind, occurred_at, source, decided_by, stage, summary")');
  });

  it("the demo board fills the page: one in each state, an unread answer and a role to fill in", async () => {
    const state = seedState(NOW, "America/Denver");
    const store = createMemoryStore(state);
    const [apps, events, heard] = await Promise.all([store.applications.list(), store.applicationEvents.listed(), store.notifications.recent(50)]);
    const rows = pipelineRows(apps, events, heard, NOW);
    expect(filterCounts(rows)).toEqual({ all: 6, active: 4, quiet: 1, closed: 1 });
    expect(rows.filter((r) => r.unread > 0).map((r) => r.company).sort()).toEqual(["Halcyon AI", "Northwind Labs"]);
    expect(rows.every((r) => r.latest !== null)).toBe(true);
    expect(needsYou([], apps).map((i) => (i.kind === "role" ? i.app.company : ""))).toEqual(["Lumen Works"]);
  });
});
