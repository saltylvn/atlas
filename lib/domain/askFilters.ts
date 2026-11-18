// Ask Atlas: reading filters out of a question.
//
// "Which emails from last week mention an interview?" is two things: a search ("mention
// an interview") and two filters (emails only, last week only). Search alone handles the
// filters badly: "last week" matches no passage, and embeddings do not know what day it
// is. So the filters are read here, by rules, and applied in the database.
//
// Rules, not a model, on purpose: the same question always gives the same filter, it is
// tested, it adds no latency and costs nothing. If a filtered search finds nothing, the
// caller searches again without filters, so a wrong guess here can only narrow a search
// that would otherwise have succeeded.

import { addDays, mondayOf, zonedToUtc } from "./dates";
import type { KnowledgeSource } from "./knowledge";

export interface AskFilters {
  /** Kinds of record to search, or null for all. */
  sources: KnowledgeSource[] | null;
  /** Records that happened at or after this instant (ISO), or null. */
  since: string | null;
  /** Records that happened before this instant (ISO), or null. */
  until: string | null;
  /** What was understood, for the page: "emails, last week". Empty when nothing was. */
  label: string;
}

export const NO_FILTERS: AskFilters = { sources: null, since: null, until: null, label: "" };

const SOURCE_WORDS: [RegExp, KnowledgeSource[], string][] = [
  [/\b(e-?mails?|inbox|mail|wrote|sent me|messages?)\b/i, ["email"], "emails"],
  [/\b(appl(y|ied|ication|ications)|recruiters?)\b/i, ["application", "email"], "applications"],
  [/\b(job match(es)?|matches|postings?|openings?|listings?)\b/i, ["job"], "job matches"],
  [/\b(resumes?|cv|my experience|my background|my skills|have i (done|built|worked))\b/i, ["resume"], "resumes"],
  [/\b(bills?|renewals?|subscriptions?|registration|passport)\b/i, ["renewal", "email"], "bills and renewals"],
  [/\b(briefs?|briefing)\b/i, ["brief"], "briefs"],
  [/\b(tasks?|to-?dos?)\b/i, ["task"], "tasks"],
  [/\b(goals?)\b/i, ["goal"], "goals"],
  [/\b(projects?|ideas?)\b/i, ["project"], "projects"],
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A [from, to) range of local days named in the question, and how to say it back. */
function dayRange(q: string, today: string): { from: string; to: string; label: string } | null {
  const monday = mondayOf(today);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  if (/\byesterday\b/.test(q)) return { from: addDays(today, -1), to: today, label: "yesterday" };
  if (/\b(today|this morning|this afternoon|tonight)\b/.test(q)) return { from: today, to: addDays(today, 1), label: "today" };
  if (/\bthis week\b/.test(q)) return { from: monday, to: addDays(monday, 7), label: "this week" };
  if (/\b(last|past|previous) week\b/.test(q)) return { from: addDays(monday, -7), to: monday, label: "last week" };
  if (/\bthis month\b/.test(q)) return { from: firstOfMonth, to: addDays(today, 1), label: "this month" };
  if (/\b(last|previous) month\b/.test(q)) {
    const lastDayPrev = addDays(firstOfMonth, -1);
    return { from: `${lastDayPrev.slice(0, 8)}01`, to: firstOfMonth, label: "last month" };
  }
  const n = /\b(?:last|past) (\d{1,2}) days?\b/.exec(q);
  if (n) return { from: addDays(today, -Number(n[1])), to: addDays(today, 1), label: `the last ${Number(n[1])} days` };
  if (/\b(recent(ly)?|lately|latest)\b/.test(q)) return { from: addDays(today, -14), to: addDays(today, 1), label: "the last two weeks" };
  const m = new RegExp(`\\b(?:in|during|from) (${MONTHS.join("|")})\\b`).exec(q);
  if (m) {
    const month = MONTHS.indexOf(m[1]!) + 1;
    // The most recent such month: this year's if it has started, else last year's.
    const year = Number(today.slice(0, 4)) - (month > Number(today.slice(5, 7)) ? 1 : 0);
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    return { from, to: next, label: `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${year}` };
  }
  return null;
}

export function parseFilters(question: string, today: string, timeZone: string): AskFilters {
  const q = question.toLowerCase();
  const sources = new Set<KnowledgeSource>();
  const labels: string[] = [];
  for (const [re, kinds, label] of SOURCE_WORDS) {
    if (!re.test(q)) continue;
    for (const k of kinds) sources.add(k);
    labels.push(label);
  }
  // A time window is about when something happened. "Due this week" and "next week" look
  // forward, and a bill's due date is in its text, not its timestamp: leave those to search.
  const forward = /\b(due|upcoming|next|tomorrow|coming up|expires?|deadline)\b/.test(q);
  const range = forward ? null : dayRange(q, today);
  if (range) labels.push(range.label);
  if (sources.size === 0 && !range) return NO_FILTERS;
  return {
    sources: sources.size ? [...sources] : null,
    since: range ? zonedToUtc(range.from, "00:00", timeZone).toISOString() : null,
    until: range ? zonedToUtc(range.to, "00:00", timeZone).toISOString() : null,
    label: labels.join(", "),
  };
}

export const hasFilters = (f: AskFilters) => Boolean(f.sources || f.since || f.until);
