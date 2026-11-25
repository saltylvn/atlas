// What the Atlas Autofill extension (extension/safari) is given: your answer bank, shaped
// for filling forms. Pure.
//
// The Setup page (Career) embeds this as JSON; the extension's content script reads it there
// and keeps a copy in Safari's extension storage. {company} and {role} stay as written:
// the extension fills them in for each application, after you confirm the company and role.
// Questions Atlas never answers for you (work authorization, sponsorship, demographic and
// EEO questions) are not in here at all.

import { ANSWER_BANK } from "./careerPrep";
import { isPostingLine } from "./postingFacts";
import { coreTitle } from "./similarTitles";
import type { Approval, JobMatch } from "./types";

/** Bumped when the shape changes, so an old extension can say it needs updating. */
export const AUTOFILL_VERSION = 1;

export interface AutofillData {
  v: number;
  /** When this copy was made, ISO. */
  at: string;
  fields: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    city: string;
    linkedin: string;
    github: string;
    portfolio: string;
    location: string;
    startDate: string;
    salary: string;
    yearsExperience: string;
    intro: string;
    whyCompany: string;
    whyLooking: string;
    project: string;
    aiExperience: string;
    workHistory: string;
  };
}

const URL_RE = /\bhttps?:\/\/[^\s,;<>"')]+|\b(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s,;<>"')]+/gi;
const withScheme = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

/** The links in your "LinkedIn, GitHub and portfolio" answer, sorted into the three fields forms ask for. */
export function splitLinks(text: string): { linkedin: string; github: string; portfolio: string } {
  const urls = (text.match(URL_RE) ?? []).map((u) => withScheme(u.replace(/[.,]+$/, "")));
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const linkedin = urls.find((u) => host(u) === "linkedin.com" || host(u).endsWith(".linkedin.com")) ?? "";
  const github = urls.find((u) => host(u) === "github.com") ?? "";
  const portfolio = urls.find((u) => u !== linkedin && u !== github && host(u) !== "") ?? "";
  return { linkedin, github, portfolio };
}

/** "Sam Q. Rivera" -> first "Sam", last "Rivera". A single word is a first name. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.at(-1)! };
}

export function autofillData(saved: Record<string, string> | undefined, now: Date = new Date()): AutofillData {
  const known = new Set(ANSWER_BANK.map((q) => q.id));
  const a = (id: string) => (known.has(id) ? (saved?.[id] ?? "").trim() : "");
  // Your own answer, else the bank's starter text where it has one (salary, start date, location).
  const or = (id: string) => a(id) || (ANSWER_BANK.find((q) => q.id === id)?.starter ?? "");
  const fullName = a("fullName");
  return {
    v: AUTOFILL_VERSION,
    at: now.toISOString(),
    fields: {
      fullName,
      ...splitName(fullName),
      email: a("email"),
      phone: a("phone"),
      city: a("city"),
      ...splitLinks(or("links")),
      location: or("location"),
      startDate: or("startDate"),
      salary: or("salary"),
      yearsExperience: a("yearsExperience"),
      intro: a("intro"),
      whyCompany: a("whyCompany"),
      whyLooking: a("whyLooking"),
      project: a("project"),
      aiExperience: a("aiExperience"),
      workHistory: a("workHistory"),
    },
  };
}

/** JSON that is safe inside a <script type="application/json"> tag: no "<" can close it early. */
export const embedJson = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// ---------------------------------------------------------------------------
// The Apply Queue, for the extension's popup
//
// The Career page embeds this as JSON beside the queue; the extension's content script reads
// it there, while you are signed in, and keeps a copy in Safari's extension storage. No token
// is involved, and the extension asks Atlas for nothing. It holds what you need on a job
// site: which job, the company and role for your answers, which resume to attach, and what
// the posting asks for. Never an answer to a question Atlas does not answer for you.

/** Bumped when the shape changes. */
export const QUEUE_VERSION = 1;
/** The page element the extension reads the queue from, and the one it writes its status to. */
export const EXTENSION_QUEUE_ID = "atlas-extension-queue";
export const EXTENSION_STATUS_ID = "atlas-extension-status";
/** How many jobs the extension is given: the first ones in the queue's order. */
export const QUEUE_MAX = 60;

export interface ExtensionJob {
  /** The job's id in the queue, so "Mark submitted" can point Atlas at it. */
  id: string;
  /** The posting's title and company, as Atlas shows them. */
  title: string;
  company: string;
  /** The role as your answers should name it: the title without its level and team. */
  role: string;
  /** The posting. Always https. */
  url: string;
  /** Your target role, which is the resume to attach. */
  resume: string;
  /** You marked it Perfect fit. */
  perfect: boolean;
  /** What the posting asks for, as Atlas read it: a few lines. */
  facts: string[];
}

export interface ExtensionQueue {
  v: number;
  at: string;
  jobs: ExtensionJob[];
}

/**
 * The queue as the extension gets it: the application kits waiting in the Apply Queue, in the
 * order the page lists them. `kits` are those kits; `jobs` the match behind each, by match id;
 * `perfect` the ids of matches marked Perfect fit. A kit with no https link is left out: there
 * is nothing to open.
 */
export function extensionQueue(kits: readonly Pick<Approval, "id" | "kind" | "title" | "detail" | "url" | "matchId">[], jobs: ReadonlyMap<string, Pick<JobMatch, "title" | "company" | "role">>, perfect: ReadonlySet<string>, now: Date = new Date()): ExtensionQueue {
  const out: ExtensionJob[] = [];
  for (const kit of kits) {
    if (kit.kind !== "application" || !/^https:\/\//.test(kit.url)) continue;
    const job = kit.matchId ? jobs.get(kit.matchId) : undefined;
    const [fromTitle, ...rest] = kit.title.split(" at ");
    const title = (job?.title ?? fromTitle ?? kit.title).trim().slice(0, 200);
    out.push({
      id: kit.id,
      title,
      company: (job?.company ?? rest.join(" at ")).trim().slice(0, 160),
      role: coreTitle(title).slice(0, 160) || title.slice(0, 160),
      url: kit.url.slice(0, 600),
      resume: (job?.role ?? "").slice(0, 80),
      perfect: Boolean(kit.matchId && perfect.has(kit.matchId)),
      facts: kit.detail.split("\n").filter(isPostingLine).slice(0, 5).map((l) => l.trim().slice(0, 200)),
    });
    if (out.length >= QUEUE_MAX) break;
  }
  return { v: QUEUE_VERSION, at: now.toISOString(), jobs: out };
}

/** A job's id as it may appear in a link back to Atlas. */
export const kitId = (raw: string | undefined): string => (raw && /^[A-Za-z0-9-]{1,64}$/.test(raw) ? raw : "");
/** Where the extension's "Mark submitted" sends you: the Career page, asking about that one job. */
export const KIT_CHECK_ID = "kit-check";
export const kitCheckHref = (id: string): string => `/career?kit=${encodeURIComponent(id)}#${KIT_CHECK_ID}`;
