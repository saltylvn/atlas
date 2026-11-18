// What the Atlas Autofill extension (extension/safari) is given: your answer bank, shaped
// for filling forms. Pure.
//
// The Applications page embeds this as JSON; the extension's content script reads it there
// and keeps a copy in Safari's extension storage. {company} and {role} stay as written:
// the extension fills them in for each application, after you confirm the company and role.
// Questions Atlas never answers for you (work authorization, sponsorship, demographic and
// EEO questions) are not in here at all.

import { ANSWER_BANK } from "./careerPrep";

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
    rate: string;
    availability: string;
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
      rate: a("rate"),
      availability: or("availability"),
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
