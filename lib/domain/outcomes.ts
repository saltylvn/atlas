// Step 0 of the agent plan (owner's request, 23 Nov 2026): what each application was sent
// with, and what the outcomes say. Pure: no I/O.
//
//   applyFacts  the facts recorded when you apply: level, posting date, resume version, warm
//   linkKit     for an application logged from an email, the queued job it most likely was,
//               so it gets the same facts
//   funnel      reply rates sliced by level, role, source, posting age, resume, tailored, warm,
//               counting only applications old enough to judge
//   diagnose    plain-language reads of the funnel: where the drop-off is, and what it points at

import { titleLevel } from "./careerAgent";
import { canonicalRole } from "./targetRoles";
import { daysBetween } from "./dates";
import type { Application, Approval, JobMatch, LocalDate } from "./types";

export type Level = "early" | "mid" | "senior" | "unstated";

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|manager)\b/i;

/** The level a title states: senior, staff and lead words first, then Junior / Associate / I, then II. */
export function levelOf(title: string): Level {
  if (SENIOR.test(title)) return "senior";
  const l = titleLevel(title);
  if (l === "early") return "early";
  if (l === "mid") return "mid";
  if (l === "upper") return "senior";
  return "unstated";
}

/** A short fingerprint of a resume's text (FNV-1a): it changes whenever the text does. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** "Software Engineer 1 · 3fa2c19b": the resume for a role, and which version of its text. */
export function resumeVersion(role: string, resumes: readonly { name: string; text: string }[]): string {
  if (!role) return "";
  const want = canonicalRole(role);
  const r = resumes.find((x) => canonicalRole(x.name) === want);
  return r ? `${r.name} · ${fingerprint(r.text)}`.slice(0, 120) : "";
}

export interface ApplyFacts {
  level: Level;
  postedOn: LocalDate | null;
  resumeVersion: string;
  warm: boolean | null;
}

/** The facts recorded when you apply to a job from your queue. `knowSomeone`: a contact at the company. */
export function applyFacts(input: { title: string; postedAt: string | null; role: string; resumes: readonly { name: string; text: string }[]; knowSomeone: boolean }): ApplyFacts {
  return {
    level: levelOf(input.title),
    postedOn: input.postedAt ? input.postedAt.slice(0, 10) : null,
    resumeVersion: resumeVersion(input.role, input.resumes),
    warm: input.knowSomeone ? true : null,
  };
}

const company = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|labs?)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The queued job an email-logged application most likely was: the newest application kit
 * for the same company from the 21 days before, with its match. Null when there is none, or
 * when two different jobs at that company were queued (a guess would be wrong half the time).
 */
export function linkKit(app: Pick<Application, "company" | "appliedOn" | "createdAt">, kits: readonly Approval[], matches: readonly JobMatch[]): JobMatch | null {
  const day = (app.appliedOn ?? app.createdAt.slice(0, 10)) as LocalDate;
  const who = company(app.company);
  if (!who) return null;
  const byId = new Map(matches.map((m) => [m.id, m]));
  const hits = kits
    .filter((k) => k.kind === "application" && k.matchId && byId.has(k.matchId))
    .map((k) => byId.get(k.matchId!)!)
    .filter((m) => company(m.company) === who && daysBetween(m.shownOn, day) >= 0 && daysBetween(m.shownOn, day) <= 21);
  const distinct = [...new Map(hits.map((m) => [m.id, m])).values()];
  return distinct.length === 1 ? distinct[0]! : null;
}

// ---------------------------------------------------------------------------
// The funnel

/** Days after applying before silence counts as an answer: most screens reply within two weeks. */
export const JUDGE_AFTER_DAYS = 14;

export type Outcome = "too-new" | "silent" | "rejected" | "replied";

/** Where one sent application stands for learning: an answer, a rejection, silence, or too new to tell. */
export function outcomeOf(a: Pick<Application, "status" | "appliedOn" | "createdAt">, today: LocalDate): Outcome {
  if (a.status === "replied" || a.status === "interview" || a.status === "offer") return "replied";
  if (a.status === "rejected") return "rejected";
  const sent = (a.appliedOn ?? a.createdAt.slice(0, 10)) as LocalDate;
  return daysBetween(sent, today) >= JUDGE_AFTER_DAYS ? "silent" : "too-new";
}

export interface Slice {
  key: string;
  sent: number;
  /** Rejected, replied or silent long enough: the ones that say something. */
  judged: number;
  replied: number;
  rejected: number;
  /** Rejected within 10 days: the sign of a screen (automated or a recruiter's first pass). */
  fastRejections: number;
}

export interface Funnel {
  sent: number;
  judged: number;
  tooNew: number;
  replied: number;
  rejected: number;
  /** Share of judged applications that got any reply. */
  replyRate: number;
  /** Applications missing the facts Step 0 records (logged before it, or not linked). */
  unknownFacts: number;
  by: Record<"level" | "role" | "source" | "age" | "resume" | "tailored" | "warm", Slice[]>;
}

const ageBucket = (a: Pick<Application, "postedOn" | "appliedOn">): string => {
  if (!a.postedOn || !a.appliedOn) return "unknown";
  const d = daysBetween(a.postedOn, a.appliedOn);
  return d <= 3 ? "0-3 days old" : d <= 10 ? "4-10 days old" : "11+ days old";
};
const yesNo = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "unknown");

export function funnel(apps: readonly Application[], today: LocalDate): Funnel {
  const sent = apps.filter((a) => a.status !== "saved");
  const rows = sent.map((a) => {
    const o = outcomeOf(a, today);
    const fast = o === "rejected" && a.appliedOn ? daysBetween(a.appliedOn, a.statusAt.slice(0, 10)) <= 10 : false;
    return { a, o, fast };
  });
  const slice = (keyOf: (a: Application) => string): Slice[] => {
    const m = new Map<string, Slice>();
    for (const { a, o, fast } of rows) {
      const k = keyOf(a) || "unknown";
      const s = m.get(k) ?? { key: k, sent: 0, judged: 0, replied: 0, rejected: 0, fastRejections: 0 };
      s.sent++;
      if (o !== "too-new") s.judged++;
      if (o === "replied") s.replied++;
      if (o === "rejected") s.rejected++;
      if (fast) s.fastRejections++;
      m.set(k, s);
    }
    return [...m.values()].sort((x, y) => y.sent - x.sent || x.key.localeCompare(y.key));
  };
  const judged = rows.filter((r) => r.o !== "too-new").length;
  const replied = rows.filter((r) => r.o === "replied").length;
  return {
    sent: sent.length,
    judged,
    tooNew: rows.filter((r) => r.o === "too-new").length,
    replied,
    rejected: rows.filter((r) => r.o === "rejected").length,
    replyRate: judged ? replied / judged : 0,
    unknownFacts: sent.filter((a) => !a.level && !a.resumeVersion && !a.postedOn).length,
    by: {
      level: slice((a) => a.level ?? levelOf(a.role)),
      role: slice((a) => a.targetRole),
      source: slice((a) => a.source),
      age: slice(ageBucket),
      resume: slice((a) => a.resumeVersion ?? ""),
      tailored: slice((a) => yesNo(a.tailored)),
      warm: slice((a) => yesNo(a.warm)),
    },
  };
}

export interface Finding {
  /** Stable name, so memory can recognise the same finding on a later day. */
  id: string;
  text: string;
}

/** What the funnel says, most telling first, each with a stable id. Every number comes from the funnel. */
export function findings(f: Funnel): Finding[] {
  const out: Finding[] = [];
  const add = (id: string, text: string) => out.push({ id, text });
  if (f.sent === 0) return [{ id: "none-sent", text: "No applications sent yet: the funnel starts with the first one." }];
  if (f.judged < 10) add("early-read", `${f.judged} of ${f.sent} applications are old enough to judge (${JUDGE_AFTER_DAYS} days, or an answer). Read these patterns as early signs, not findings.`);
  const fast = f.by.level.reduce((n, s) => n + s.fastRejections, 0);
  if (f.rejected >= 3 && fast / f.rejected >= 0.6) add("fast-screen", `${fast} of ${f.rejected} rejections came within 10 days of applying: that is a screen saying no, usually on keywords, level or a hard requirement, before a person reads closely. Tailoring and level are the levers.`);
  const senior = f.by.level.find((s) => s.key === "senior");
  if (senior && senior.sent >= 3 && senior.replied === 0) add("senior-silent", `${senior.sent} applications went to senior, staff or lead titles with no reply: those ask for more years than you have. Junior, associate and level I roles are the better bet.`);
  const unstated = f.by.level.find((s) => s.key === "unstated");
  if (unstated && f.sent >= 5 && unstated.sent / f.sent >= 0.6) add("level-unstated", `${unstated.sent} of ${f.sent} applications have no level in their title: check the years asked before applying (3+ years usually means mid or senior).`);
  const tailoredYes = f.by.tailored.find((s) => s.key === "yes");
  const tailoredNo = f.by.tailored.find((s) => s.key === "no");
  if (tailoredYes && tailoredNo && tailoredYes.judged >= 3 && tailoredNo.judged >= 3) {
    const a = tailoredYes.replied / tailoredYes.judged;
    const b = tailoredNo.replied / tailoredNo.judged;
    if (a !== b) add("tailored", `Tailored applications got replies ${Math.round(a * 100)}% of the time, untailored ${Math.round(b * 100)}% (${tailoredYes.judged} and ${tailoredNo.judged} judged).`);
  }
  const warmYes = f.by.warm.find((s) => s.key === "yes");
  if (warmYes && warmYes.judged >= 2) add("warm", `Warm applications (you knew someone): ${warmYes.replied} replies from ${warmYes.judged} judged.`);
  if (f.unknownFacts > 0) add("unknown-facts", `${f.unknownFacts} of ${f.sent} applications were logged without their facts (level, posting date, resume). Every application from now on records them; mark Tailored and Warm on each to sharpen the read.`);
  return out;
}

/** What the funnel says, in plain words, most telling first. */
export function diagnose(f: Funnel): string[] {
  return findings(f).map((x) => x.text);
}

export const LEVEL_LABEL: Record<Level, string> = { early: "Junior, associate or I", mid: "Level II", senior: "Senior, staff or lead", unstated: "No level stated" };
