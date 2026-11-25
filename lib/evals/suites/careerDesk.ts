import { savedJobKey, todaysPicks } from "@/lib/domain/applyPlan";
import type { RawJob } from "@/lib/domain/careerAgent";
import { marketReport, numbersGrounded, observePostings, rulesSummary, type MarketPosting, type MarketReport } from "@/lib/domain/market";
import { acceptInsights, eligible, observe, rulesInsights, slotAt, type MentorInput, type MentorInsight, type MentorSlot } from "@/lib/domain/mentor";
import { acceptProfile, roleCard } from "@/lib/domain/roleProfile";
import { rolesFrom } from "@/lib/domain/targetRoles";
import type { Application, Approval, JobMatch } from "@/lib/domain/types";
import type { EvalCase, EvalSuite } from "../types";

// The Career desk. Three suites, one per new agent, all on fictional data:
//   Scout     does it record what the market shows, including jobs you would not take?
//   Analyst   are demand, pay, fit and gaps computed right, and is invented wording caught?
//   Career Mentor    given a situation, does it raise the right thing first, remember what it
//             said, stay quiet when there is nothing to say, and refuse a made-up fact?

const TODAY = "2026-11-16";
const ROLES = rolesFrom(["AI Engineer", "Solutions Engineer", "Forward Deployed Engineer"]);
const REMOTE = new Set(["Remote OK"]);
const day = (n: number) => new Date(Date.UTC(2026, 10, 16 + n)).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Scout

const raw = (o: Partial<RawJob> & Pick<RawJob, "key" | "title">): RawJob => ({ source: "Remote OK", company: "Northwind", url: `https://jobs.example/${o.key}`, location: "Remote", text: "", postedAt: null, ...o });
const seen = observePostings(
  [
    raw({ key: "a", title: "AI Engineer", text: "Python, RAG and LangChain. $150,000 - $180,000 a year." }),
    raw({ key: "b", title: "AI Engineer", text: "We pay $60,000 - $70,000.", location: "Berlin, Germany", source: "Greenhouse" }),
    raw({ key: "c", title: "Staff Accountant", text: "Excel" }),
    raw({ key: "a", title: "AI Engineer", text: "Python, RAG and LangChain. $150,000 - $180,000 a year." }),
    raw({ key: "d", title: "Solutions Engineer", url: `https://jobs.example/${"x".repeat(700)}` }),
    raw({ key: "e", title: "Solutions Engineer", text: "Contract, $80/hr, 3 months" }),
  ],
  ROLES,
  REMOTE,
  TODAY,
);
const got = (key: string) => seen.find((p) => p.key === key);

const scoutCases: EvalCase[] = [
  { name: "Records a posting that is one of your roles", expected: "AI Engineer", actual: () => got("a")?.role ?? "not recorded" },
  { name: "Reads the pay range from the text", expected: "150000-180000 year", actual: () => `${got("a")?.payMin}-${got("a")?.payMax} ${got("a")?.payUnit}` },
  { name: "Reads the skills the posting asks for", expected: "yes", actual: () => (["Python", "RAG"].every((s) => got("a")?.skills.includes(s)) ? "yes" : `got ${got("a")?.skills.join(", ")}`) },
  { name: "Keeps a posting under your pay floor: it is still the market", expected: "recorded", actual: () => (got("b") ? "recorded" : "dropped") },
  { name: "Marks a posting you could not take as another place, not remote", expected: "other", actual: () => got("b")?.place ?? "not recorded" },
  { name: "Marks a remote board's posting as remote", expected: "remote", actual: () => got("a")?.place ?? "not recorded" },
  { name: "Ignores a title that is none of your roles", expected: "not recorded", actual: () => (got("c") ? "recorded" : "not recorded") },
  { name: "Records a posting once when two feeds carry it", expected: "1", actual: () => String(seen.filter((p) => p.key === "a").length) },
  { name: "Skips a posting whose link is too long to store", expected: "not recorded", actual: () => (got("d") ? "recorded" : "not recorded") },
  { name: "Leaves out a contract posting: full-time roles only", expected: "not recorded", actual: () => (got("e") ? "recorded" : "not recorded") },
  { name: "Has no opinion: nothing is scored or ranked", expected: "no score", actual: () => ("score" in (got("a") ?? {}) ? "scored" : "no score") },
];

// ---------------------------------------------------------------------------
// Analyst

let n = 0;
const post = (role: string, skills: string[], o: Partial<MarketPosting> = {}): MarketPosting => ({ id: `p${++n}`, key: `k${n}`, title: role, company: `Co ${n % 4}`, source: n % 2 ? "Greenhouse" : "Remote OK", url: "https://jobs.example/x", location: "Remote", role, place: "remote", payMin: null, payMax: null, payUnit: "", skills, postedAt: null, firstSeen: day(-3), lastSeen: TODAY, createdAt: "", ...o });
const MARKET: MarketPosting[] = [
  ...Array.from({ length: 6 }, () => post("AI Engineer", ["Python", "RAG", "Kubernetes"], { payMin: 150_000, payMax: 170_000, payUnit: "year" })),
  ...Array.from({ length: 4 }, () => post("AI Engineer", ["Python", "Kubernetes"], { firstSeen: day(-10) })),
  ...Array.from({ length: 5 }, () => post("Solutions Engineer", ["SQL", "APIs"], { place: "other", location: "Austin, TX", payMin: 110_000, payMax: 130_000, payUnit: "year" })),
  post("Forward Deployed Engineer", ["Python"]),
  post("AI Engineer", ["Python"], { lastSeen: day(-45), firstSeen: day(-50) }),
];
const HAVE = ["Python", "RAG", "SQL", "APIs"];
const report = marketReport(MARKET, ROLES, HAVE, TODAY);
const role = (name: string) => report.roles.find((r) => r.role === name)!;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const analystCases: EvalCase[] = [
  { name: "Counts only postings seen in the last 30 days", expected: "16", actual: () => String(report.total) },
  { name: "Counts postings per role", expected: "10, 5, 1", actual: () => report.roles.map((r) => r.postings).join(", ") },
  { name: "Lists your roles in your priority order", expected: "AI Engineer, Solutions Engineer, Forward Deployed Engineer", actual: () => report.roles.map((r) => r.role).join(", ") },
  { name: "Counts new postings this week and the week before", expected: "6 and 4", actual: () => `${role("AI Engineer").thisWeek} and ${role("AI Engineer").lastWeek}` },
  { name: "Calls a rise a trend only with enough postings behind it", expected: "up", actual: () => role("AI Engineer").trend },
  { name: "Does not call one posting a trend", expected: "flat", actual: () => role("Forward Deployed Engineer").trend },
  { name: "Finds the median posted pay", expected: "160000", actual: () => String(role("AI Engineer").payMedian) },
  { name: "Says no pay when none is posted", expected: "null", actual: () => String(role("Forward Deployed Engineer").payMedian) },
  { name: "Measures how much of a role you could actually work", expected: "0%", actual: () => pct(role("Solutions Engineer").reachable) },
  { name: "Ranks the skills a role asks for most", expected: "Python 100%, Kubernetes 100%, RAG 60%", actual: () => role("AI Engineer").topSkills.sort((a, b) => b.share - a.share || (a.skill === "Python" ? -1 : 1)).map((s) => `${s.skill} ${pct(s.share)}`).join(", ") },
  { name: "Measures coverage: the share of what is asked that you have", expected: "62%", actual: () => pct(role("AI Engineer").coverage) },
  { name: "Names the best fit by coverage, demand and reach, not coverage alone", expected: "AI Engineer", actual: () => report.bestFit?.role ?? "none" },
  { name: "Puts the most-asked skill you lack first among gaps", expected: "Kubernetes", actual: () => report.gaps[0]?.skill ?? "none" },
  { name: "Never lists a skill you have as a gap", expected: "none", actual: () => report.gaps.filter((g) => HAVE.includes(g.skill)).map((g) => g.skill).join(", ") || "none" },
  { name: "With no postings, says so instead of guessing a fit", expected: "no fit", actual: () => (marketReport([], ROLES, HAVE, TODAY).bestFit ? "guessed" : "no fit") },
  { name: "With no skills marked, names no best fit and no gaps", expected: "no fit, 0 gaps", actual: () => { const r = marketReport(MARKET, ROLES, [], TODAY); return `${r.bestFit ? "a fit" : "no fit"}, ${r.gaps.length} gaps`; } },
  { name: "With no skills marked, the advice is to mark them", expected: "yes", actual: () => (/Tick the skills/.test(rulesSummary(marketReport(MARKET, ROLES, [], TODAY)).focus) ? "yes" : "no") },
  { name: "States every number as a fact a reader can check", expected: "yes", actual: () => (report.facts.some((f) => f.includes("AI Engineer: 10 postings, 6 new this week")) ? "yes" : report.facts.join(" | ")) },
  { name: "Accepts wording that only uses the report's numbers", expected: "kept", actual: () => (numbersGrounded(["AI Engineer has 10 postings, 6 of them new.", "You cover 62% of it."], report.facts) ? "kept" : "thrown away") },
  { name: "Throws away wording with a number the report does not hold", expected: "thrown away", actual: () => (numbersGrounded(["Demand is up 40% and pay averages $185k."], report.facts) ? "kept" : "thrown away") },
  { name: "Words the report by rules when there is no model", expected: "rules", actual: () => rulesSummary(report).writer },
  { name: "Rules wording points at the top gap", expected: "yes", actual: () => (rulesSummary(report).focus.includes("Kubernetes") ? "yes" : rulesSummary(report).focus) },
];

// ---------------------------------------------------------------------------
// Career Mentor

let a = 0;
const app = (o: Partial<Application>): Application => ({ id: `app-${++a}`, company: `Company ${a}`, role: "AI Engineer", targetRole: "AI Engineer", source: "greenhouse", url: "https://jobs.example/a", payText: "", tier: "semi", status: "applied", appliedOn: day(-10), statusAt: `${day(-10)}T15:00:00Z`, notes: "", origin: "atlas", externalId: "", createdAt: `${day(-10)}T15:00:00Z`, ...o });
const kit = (daysOld: number, kind: Approval["kind"] = "application"): Approval => ({ id: `ap-${++a}`, kind, title: "Apply", detail: "", url: "https://jobs.example/a", matchId: null, status: "pending", decidedAt: null, createdAt: `${day(-daysOld)}T15:00:00Z` });
const LINKEDIN = `AI Engineer building agents, RAG and automation. ${"I build production systems with evals and tests. ".repeat(12)}`;
const base = (o: Partial<MentorInput> = {}): MentorInput => ({ today: TODAY, slot: "morning", roles: ROLES.map((r) => r.name), applications: [], approvals: [], matches: [], market: null, skills: [], resumes: null, answersWritten: 9, answersTotal: 9, linkedin: LINKEDIN, plan: 3, prior: [], ...o });
const said = (key: string, o: Partial<MentorInsight> = {}): MentorInsight => ({ id: `i-${++a}`, forDate: day(-1), slot: "morning", key, area: "activity", title: "Earlier insight", body: "b", action: "Do the thing", evidence: [], metric: "0", writer: "rules", status: "new", createdAt: "", ...o });
const top = (i: MentorInput) => eligible(i)[0]?.id ?? "nothing";
const has = (i: MentorInput, id: string) => (eligible(i).some((o) => o.id === id || o.id.startsWith(id)) ? "raised" : "not raised");
const recentOne = app({ appliedOn: day(-1), statusAt: `${day(-1)}T15:00:00Z` });
const silent = (rate: number) => [...Array.from({ length: 10 }, (_, i) => app({ status: i < rate ? "replied" : "applied", statusAt: `${day(-9)}T15:00:00Z` })), recentOne];
const market = (o: Partial<MarketReport> = {}): MarketReport => ({ ...report, ...o });

const perfectJob: JobMatch = { id: "p1", key: "p1", title: "AI Engineer", company: "Northwind", url: "https://job-boards.greenhouse.io/northwind/jobs/7", source: "Greenhouse", location: "Remote", role: "AI Engineer", payText: "$120k", postedAt: null, score: 80, shownOn: day(-2), shownSlot: "morning", rating: 2, status: "pursuing", skills: ["Python", "RAG"], createdAt: `${day(-2)}T15:00:00Z` };
const perfectKit: Approval = { ...kit(2), matchId: "p1", url: perfectJob.url };
const knows = [{ id: "c1", name: "Dana Lee", circle: "network", email: null, phone: null, cadenceDays: 0, lastContactAt: null, notes: "Engineer at Northwind" }] as unknown as NonNullable<MentorInput["contacts"]>;

const profiled = roleCard("AI Engineer", 1, [{ role: "AI Engineer", target: true, postings: 42, thisWeek: 9, lastWeek: 6, trend: "up", reachable: 0.8, payMedian: 120_000, asked: [{ skill: "Python", share: 0.7, shown: true, projects: [] }, { skill: "RAG", share: 0.5, shown: false, projects: [] }], qualified: 0.62, projects: [], applied: 4, responses: 1, thin: false, score: 70 }], []);
const profile = { does: "You connect a customer's systems to the product: you learn what they need, build the integration, and stay with them until it runs.", tempo: "Customer-paced, with several accounts moving at once and results judged by what goes live.", project: "Build a small RAG service behind an API and write up how a customer would connect it.", closeSkill: "RAG", closeWhy: "RAG is asked for in 50% of the postings and nothing you have built shows it." };
const kept = (o: Partial<typeof profile>) => (acceptProfile({ ...profile, ...o }, profiled) ? "kept" : "dropped");

const mentorCases: EvalCase[] = [
  // Target Roles: the weekly profile of a role
  { name: "A role profile that rests on the role's facts is kept", expected: "kept", actual: () => kept({}) },
  { name: "A role profile that adds a statistic is dropped", expected: "dropped", actual: () => kept({ tempo: "Fast: people here close 12 deals a quarter and are judged on it alone." }) },
  { name: "A role profile cannot name a gap the role does not have", expected: "dropped", actual: () => kept({ closeSkill: "Kubernetes" }) },
  { name: "A role profile's project cannot use a skill the postings do not ask for", expected: "dropped", actual: () => kept({ project: "Deploy a small service on AWS Lambda and document how a customer would call it." }) },
  { name: "A role the Analyst has not measured gets no profile, whatever the model writes", expected: "no profile", actual: () => (acceptProfile(profile, roleCard("Data Engineer", 2, [], [])) ? "a profile" : "no profile") },
  // The jobs he most wants
  { name: "A job marked Perfect fit and not applied to comes before the daily plan", expected: "perfect:p1", actual: () => top(base({ applications: [recentOne], approvals: [perfectKit], perfect: [perfectJob] })) },
  { name: "A perfect fit's advice starts with the person he knows there", expected: "yes", actual: () => (/^Message Dana Lee about Northwind before you apply/.test(observe(base({ approvals: [perfectKit], perfect: [perfectJob], contacts: knows })).find((o) => o.id === "perfect:p1")?.action ?? "") ? "yes" : "no") },
  { name: "A perfect fit says which asked-for skills he has, as numbers a reader can check", expected: "yes", actual: () => (observe(base({ approvals: [perfectKit], perfect: [perfectJob], skills: ["Python"] })).find((o) => o.id === "perfect:p1")?.fact.includes("you have 1 of 2, and not RAG") ? "yes" : "no") },
  { name: "With no job marked Perfect fit, nothing is said about one", expected: "not raised", actual: () => has(base({ applications: [recentOne] }), "perfect:") },
  { name: "With no applications at all, that is the first thing", expected: "activity:none", actual: () => top(base()) },
  { name: "Five quiet days: the gap comes first in the morning", expected: "activity:gap", actual: () => top(base({ applications: [app({ appliedOn: day(-5) })] })) },
  { name: "Ten applications, no replies: the approach is the problem, not the volume", expected: "results:overall", actual: () => top(base({ applications: silent(0) })) },
  { name: "The low reply rate's advice is to fix the resume before sending more", expected: "yes", actual: () => (/Before sending more/.test(observe(base({ applications: silent(0) })).find((o) => o.id === "results:overall")?.action ?? "") ? "yes" : "no") },
  { name: "One role answers and another is silent: that difference is the insight", expected: "results:by-role", actual: () => top(base({ applications: [...Array.from({ length: 5 }, () => app({})), ...Array.from({ length: 5 }, (_, i) => app({ targetRole: "Solutions Engineer", role: "Solutions Engineer", status: i < 3 ? "replied" : "applied" })), recentOne] })) },
  { name: "Too few applications per role to compare: says nothing about roles", expected: "not raised", actual: () => has(base({ applications: [app({}), app({ targetRole: "Solutions Engineer", status: "replied" }), recentOne] }), "results:by-role") },
  { name: "An offer outranks everything", expected: "win:offer", actual: () => top(base({ applications: [...silent(0), app({ id: "offer-1", status: "offer", statusAt: `${day(-1)}T15:00:00Z` })] })).slice(0, 9) },
  { name: "A fresh interview is raised with prep as the action", expected: "yes", actual: () => (/prepare/.test(observe(base({ applications: [app({ status: "interview", statusAt: `${day(0)}T15:00:00Z` })] })).find((o) => o.id.startsWith("win:interview"))?.action ?? "") ? "yes" : "no") },
  { name: "Five apply kits waiting four days beats sending new ones", expected: "queue:waiting", actual: () => top(base({ applications: [recentOne], approvals: Array.from({ length: 5 }, () => kit(4)) })) },
  { name: "One kit added today is not worth a mention", expected: "not raised", actual: () => has(base({ applications: [recentOne], approvals: [kit(0)] }), "queue:waiting") },
  { name: "Drafted follow-ups waiting to be sent are raised", expected: "raised", actual: () => has(base({ applications: [recentOne], approvals: [kit(1, "follow-up")] }), "queue:follow-ups") },
  { name: "A skill you have, the market wants, and no resume mentions", expected: "resume:unlisted:Python", actual: () => top(base({ slot: "evening", applications: [recentOne], market: market(), skills: ["Python"], resumes: { names: ["AI Engineer", "Solutions Engineer", "Forward Deployed Engineer"], skills: [] } })) },
  { name: "A real gap names the skill and its share of postings", expected: "raised", actual: () => has(base({ market: market(), skills: HAVE, resumes: { names: [], skills: [] } }), "skills:gap:Kubernetes") },
  { name: "A gap your resume already mentions is only an unticked box", expected: "raised", actual: () => has(base({ market: market(), skills: HAVE, resumes: { names: ["AI Engineer"], skills: ["Kubernetes"] } }), "skills:unmarked:Kubernetes") },
  { name: "Priority and strengths pointing different ways is raised", expected: "raised", actual: () => has(base({ skills: HAVE, market: market({ bestFit: { role: "Solutions Engineer", coverage: 0.9, postings: 5 } }) }), "targeting:best-fit") },
  { name: "No market report means no claims about the market", expected: "none", actual: () => observe(base({ skills: HAVE })).filter((o) => o.area === "skills" || o.id.startsWith("targeting:best")).map((o) => o.id).join(", ") || "none" },
  { name: "Applications spread thin across roles are raised", expected: "raised", actual: () => has(base({ applications: ["AI Engineer", "Solutions Engineer", "Forward Deployed Engineer", "AI Automation Engineer", "AI Engineer", "Software Engineer"].map((r) => app({ targetRole: r, appliedOn: day(-2), statusAt: `${day(-2)}T15:00:00Z` })) }), "targeting:spread") },
  { name: "Top roles with no resume text are raised", expected: "raised", actual: () => has(base({ resumes: { names: ["Solutions Engineer"], skills: [] } }), "resume:no-text") },
  { name: "When resumes could not be read, it does not claim they are missing", expected: "not raised", actual: () => has(base({ resumes: null }), "resume:no-text") },
  { name: "A LinkedIn opening that never says your first-priority role", expected: "raised", actual: () => has(base({ linkedin: `Builder of things. ${"I like software and teams. ".repeat(30)}` }), "profile:headline") },
  { name: "No LinkedIn text pasted: asks for it instead of reviewing nothing", expected: "raised", actual: () => has(base({ linkedin: "" }), "profile:missing") },
  { name: "A headline that says \"aspiring\" before the title", expected: "raised", actual: () => has(base({ linkedin: `Aspiring ${ROLES[0]!.name} | integrations and automation. ${"I build integrations and ship them. ".repeat(20)}` }), "profile:wording") },
  { name: "\"Entry-level\" in the first lines", expected: "raised", actual: () => has(base({ linkedin: `${ROLES[0]!.name}, entry-level | integrations and automation. ${"I build integrations and ship them. ".repeat(20)}` }), "profile:wording") },
  { name: "A headline that names the title plainly", expected: "not raised", actual: () => has(base({ linkedin: `${ROLES[0]!.name} | integrations and automation. ${"I build integrations and ship them. ".repeat(20)}` }), "profile:wording") },
  { name: "\"Seeking\" far down the About, not in the first lines", expected: "not raised", actual: () => has(base({ linkedin: `${ROLES[0]!.name} | integrations and automation. ${"I build integrations and ship them. ".repeat(20)} Seeking a collaborative team.` }), "profile:wording") },
  { name: "Never advises gig or side work: full-time roles only", expected: "never", actual: () => ([base(), base({ applications: Array.from({ length: 6 }, () => app({ appliedOn: day(-2), statusAt: `${day(-2)}T15:00:00Z` })) }), base({ market: market(), skills: HAVE, applications: silent(0) })].flatMap(observe).some((o) => /gig|freelanc|proposal|upwork|side (work|hustle|income)/i.test(`${o.id} ${o.area} ${o.fact} ${o.action}`)) ? "advised" : "never") },
  { name: "Meeting the day's plan is acknowledged", expected: "raised", actual: () => has(base({ slot: "evening", applications: Array.from({ length: 3 }, () => app({ appliedOn: TODAY, statusAt: `${TODAY}T15:00:00Z` })) }), "win:plan") },
  // Memory
  { name: "Memory: an insight you dismissed stays away", expected: "not raised", actual: () => has(base({ prior: [said("activity:none", { status: "dismissed", forDate: day(-5) })] }), "activity:none") },
  { name: "Memory: said yesterday and nothing changed is not said again", expected: "not raised", actual: () => has(base({ applications: [app({ appliedOn: day(-5) })], prior: [said("queue:answers", { metric: "4" })], answersWritten: 4 }), "queue:answers") },
  { name: "Memory: said yesterday but the number moved is worth saying", expected: "raised", actual: () => has(base({ prior: [said("queue:answers", { metric: "4" })], answersWritten: 6 }), "queue:answers") },
  { name: "Memory: handled and unchanged is left alone for a week", expected: "not raised", actual: () => has(base({ prior: [said("profile:missing", { status: "done", forDate: day(-4) })], linkedin: "" }), "profile:missing") },
  { name: "Midday: follows up on the morning's priority when nothing moved", expected: "progress:activity:none has not moved", actual: () => { const e = eligible(base({ slot: "midday", prior: [said("activity:none", { forDate: TODAY, slot: "morning" })] }))[0]; return `${e?.id} ${/has not moved/.test(e?.fact ?? "") ? "has not moved" : "?"}`; } },
  { name: "Midday: says so when the morning's priority is handled", expected: "handled", actual: () => (/is handled/.test(eligible(base({ slot: "midday", applications: [app({ appliedOn: TODAY, statusAt: `${TODAY}T15:00:00Z` })], prior: [said("activity:none", { forDate: TODAY, slot: "morning" })] })).find((o) => o.id === "progress:activity:none")?.fact ?? "") ? "handled" : "missed") },
  { name: "Midday: does not also repeat the morning's point as if it were new", expected: "not raised", actual: () => (eligible(base({ slot: "midday", prior: [said("activity:none", { forDate: TODAY, slot: "morning" })] })).some((o) => o.id === "activity:none") ? "raised" : "not raised") },
  { name: "Evening: strategy outweighs the queue", expected: "resume before queue", actual: () => { const e = eligible(base({ slot: "evening", applications: [recentOne], approvals: Array.from({ length: 3 }, () => kit(2)), market: market(), skills: ["Python"], resumes: { names: ROLES.map((r) => r.name), skills: [] } })).map((o) => o.id); return e.indexOf("resume:unlisted:Python") < e.indexOf("queue:waiting") ? "resume before queue" : e.join(", "); } },
  // Restraint and grounding
  { name: "Says at most two things a run", expected: "2", actual: () => String(rulesInsights(base({ linkedin: "", answersWritten: 2, applications: [app({ appliedOn: day(-6) })], approvals: Array.from({ length: 5 }, () => kit(5)) })).length) },
  { name: "Stays silent when nothing clears the bar", expected: "0", actual: () => String(rulesInsights(base({ plan: 0, applications: [recentOne] })).length) },
  { name: "Every insight carries the fact it rests on", expected: "yes", actual: () => (rulesInsights(base()).every((i) => i.evidence.length === 1 && i.evidence[0]!.startsWith(i.title)) ? "yes" : "no") },
  { name: "Two insights are two subjects, never the same area twice", expected: "2 areas", actual: () => { const r = rulesInsights(base({ applications: [app({ appliedOn: day(-6) })], approvals: Array.from({ length: 5 }, () => kit(5)) })); return `${new Set(r.map((i) => i.area)).size} areas`; } },
  { name: "A model cannot spend both insights on one area either", expected: "1", actual: () => { const i = base({ applications: [app({ appliedOn: day(-6) })] }); const pool = eligible(i); const p = (id: string) => ({ evidence: [id], title: "Point", insight: "Stated plainly.", action: "Do it." }); return String(acceptInsights(i, pool, [p("activity:gap"), p("activity:today")]).length); } },
  { name: "No skills marked: says so instead of calling everything a gap", expected: "skills:none-marked only", actual: () => { const o = observe(base({ market: market(), skills: [] })).filter((x) => x.area === "skills").map((x) => x.id); return o.length === 1 ? `${o[0]} only` : o.join(", "); } },
  { name: "A model's insight is kept when it cites what it was shown", expected: "kept", actual: () => { const i = base({ applications: silent(0) }); const pool = eligible(i); return acceptInsights(i, pool, [{ evidence: ["results:overall"], title: "Fix the resume first", insight: "0 of your 10 applications older than a week got a reply. That points at the page, not the pace.", action: "Rework the top third against three postings." }]).length === 1 ? "kept" : "dropped"; } },
  { name: "A model's insight with an invented number is dropped", expected: "dropped", actual: () => { const i = base({ applications: silent(0) }); return acceptInsights(i, eligible(i), [{ evidence: ["results:overall"], title: "Fix the resume first", insight: "The average reply rate in tech is 27%, and yours is far below.", action: "Rework the top third." }]).length === 0 ? "dropped" : "kept"; } },
  { name: "A model's insight citing an observation it was never shown is dropped", expected: "dropped", actual: () => { const i = base({ applications: silent(0) }); return acceptInsights(i, eligible(i), [{ evidence: ["results:made-up"], title: "x y z", insight: "Something plausible.", action: "Do it." }]).length === 0 ? "dropped" : "kept"; } },
  { name: "A model cannot say the same thing twice or exceed two", expected: "2", actual: () => { const i = base({ linkedin: "", applications: silent(0), approvals: Array.from({ length: 5 }, () => kit(5)) }); const pool = eligible(i); const p = (id: string) => ({ evidence: [id], title: "Point", insight: "Stated plainly.", action: "Do it." }); return String(acceptInsights(i, pool, [p("results:overall"), p("results:overall"), p("queue:waiting"), p("profile:missing")]).length); } },
  { name: "Knows which run it is from the clock", expected: "morning, midday, evening", actual: () => (["09:00", "14:00", "18:10"].map(slotAt) as MentorSlot[]).join(", ") },
];

// ---------------------------------------------------------------------------
// Applications: the day's picks (scored with the Applications Agent's suite)

const match = (o: Partial<JobMatch>): JobMatch => ({ id: `m-${++a}`, key: `k-${a}`, title: "AI Engineer", company: `Co ${a}`, url: "https://jobs.example/m", source: "greenhouse", location: "Remote", role: "AI Engineer", payText: "", postedAt: null, score: 50, shownOn: TODAY, shownSlot: "morning", rating: 0, status: "new", createdAt: "", ...o });
const picks = (ms: JobMatch[], apps: Application[] = []) => todaysPicks(ms, apps, TODAY, 3).picks;

export const applyCases: EvalCase[] = [
  { name: "Picks: no more than the day's plan", expected: "3", actual: () => String(picks(Array.from({ length: 6 }, () => match({}))).length) },
  { name: "Picks: what you already sent today comes off the list", expected: "1", actual: () => String(picks(Array.from({ length: 6 }, () => match({})), [app({ appliedOn: TODAY }), app({ appliedOn: TODAY })]).length) },
  { name: "Picks: a job you liked comes before a higher score", expected: "liked", actual: () => picks([match({ score: 90, title: "high" }), match({ score: 10, rating: 1, title: "liked" })])[0]!.title },
  { name: "Picks: never a job you passed on, pursued or dismissed", expected: "0", actual: () => String(picks([match({ rating: -1 }), match({ status: "pursuing" }), match({ status: "dismissed" }), match({ status: "applied" })]).length) },
  { name: "Picks: one job per company", expected: "1", actual: () => String(picks([match({ company: "Acme" }), match({ company: "acme" })]).length) },
  { name: "Picks: a plan already met leaves nothing to pick", expected: "0", actual: () => String(picks(Array.from({ length: 6 }, () => match({})), Array.from({ length: 3 }, () => app({ appliedOn: TODAY }))).length) },
  { name: "Picks: a match older than three days is stale", expected: "0", actual: () => String(picks([match({ shownOn: day(-5) })]).length) },
  { name: "Save a job: the same link saved twice is one job", expected: "same", actual: () => (savedJobKey("https://www.linkedin.com/jobs/view/123/?ref=x") === savedJobKey("https://www.linkedin.com/jobs/view/123") ? "same" : "different") },
];

export const scoutSuite: EvalSuite = { agent: "scout", title: "Recording the market", what: "Records every posting that is one of your roles, with pay, place and skills, and judges none of them.", threshold: 1, cases: scoutCases };
export const analystSuite: EvalSuite = { agent: "analyst", title: "Demand, pay, fit and gaps", what: "Computes the market report from the Scout's rows and rejects wording that adds a number.", threshold: 1, cases: analystCases };
export const mentorSuite: EvalSuite = { agent: "mentor", title: "Judgment, memory and restraint", what: "Raises the right thing first for the situation, remembers what it said, stays quiet when there is nothing to say, and refuses made-up facts.", threshold: 0.95, cases: mentorCases };
