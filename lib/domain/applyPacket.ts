// The Apply Agent's packet: one answer for each question an application form asks, and the
// reasons it must stop instead (docs/design.md, section 5.5). Pure.
//
// Who answers what:
//   contact details, links and the answer-bank questions   your answer bank, as you wrote it
//   the resume                                              the PDF for the role, from Notion
//   work authorization, sponsorship, "worked here before"   your own fixed answers; never drafted
//   phone code, country, city, school, degree, discipline,  your fixed profile answers
//     graduation year                                         (lib/domain/formProfile.ts)
//   demographic and EEO questions                           nobody: left blank, or declined
//     except Gender, when you set your own answer for it     your own fixed answer
//   any other free-text question                            Gemini, from your resumes (part 2)
//   any other required question                             nobody: the agent stops
//
// The form's questions are untrusted text from the job board. They are matched against fixed
// patterns here; none of their words decide anything else, and none is followed.

import { splitLinks, splitName } from "./autofill";
import { fillAnswer } from "./careerPrep";
import { PROFILE_LABEL, profileField, profileOf, profileOption, profileText, type FormProfile } from "./formProfile";
import type { Eligibility, PacketItem } from "./types";

/** One question of the form, as the job board describes it. */
export interface FormQuestion {
  name: string;
  label: string;
  required: boolean;
  kind: PacketItem["kind"];
  /** For a select: its options. */
  options?: { label: string; value: string }[];
}

export interface Packet {
  items: PacketItem[];
  /** Why the agent cannot submit this form as it stands. Empty means it can, once you approve. */
  stops: string[];
  /** Free-text questions Gemini is to draft from your resumes (part 2). Until drafted, each is a stop. */
  toDraft: string[];
}

// ---------------------------------------------------------------------------
// What a question asks

/** Questions that are yours alone. The packet answers them only with your own fixed answers. */
const ELIGIBILITY: readonly ["authorized" | "sponsorship" | "workedHere", RegExp][] = [
  ["sponsorship", /sponsor|\bvisa\b|h-?1b/],
  ["authorized", /authori[sz]ed to work|legally (authori[sz]ed|eligible|able) to work|right to work|work authori[sz]ation|eligible to work/],
  ["workedHere", /(previously|ever|currently or (have you )?previously) (been )?(employed|worked)|worked (for|at) .{0,40}\bbefore\b|former employee/],
];

/** Demographic and EEO questions: never answered for you. */
const DEMOGRAPHIC = /gender|\bsex\b|\brace\b|ethnic|hispanic|latin[oa]|veteran|disab|pronoun|sexual orientation|transgender|date of birth|\bage\b/;

/** Anything else no tool should answer for you, whatever the form calls it. */
const NEVER = /password|social security|\bssn\b|criminal|felony|convict|background check|current (salary|compensation|pay|base)|salary history|previous (salary|compensation)|signature|initials|captcha/;

/** Answer-bank fields, most specific first. The same reading the Safari autofill uses. */
const BANK: readonly [string, RegExp][] = [
  ["firstName", /\bfirst name\b|\bgiven name\b/],
  ["lastName", /\blast name\b|\bsurname\b|\bfamily name\b/],
  ["fullName", /\bfull name\b|\blegal name\b|^name$|\byour name\b/],
  ["email", /e ?mail/],
  ["phone", /phone|mobile|\bcell\b|telephone/],
  ["linkedin", /linked ?in/],
  ["github", /git ?hub/],
  ["heardFrom", /how did you (first )?(hear|find out|learn)|where did you (first )?(hear|find|learn|see)|how you heard/],
  ["portfolio", /portfolio|personal (web ?)?site|\bwebsite\b/],
  ["salary", /salary|compensation|pay expectation|expected pay|desired pay/],
  ["startDate", /start date|available to start|when (can|could) you start|earliest start|notice period/],
  ["yearsExperience", /years of (relevant |professional |total )?experience|how many years/],
  ["whyLooking", /why are you (looking|leaving)|reason for (leaving|looking)/],
  ["whyCompany", /why (do you want to |would you like to |are you )?(work|join|apply)|why (are you )?interested|why us\b|what (excites|attracts|draws|interests) you/],
  ["project", /project (you are|you're) proud|proudest|describe a project/],
  ["aiExperience", /\b(ai|llms?|machine learning|generative)\b.*\bexperience\b|\bexperience\b.*\b(ai|llms?|machine learning|generative)\b/],
  ["workHistory", /work history|employment history/],
  ["intro", /about (yourself|you)\b|tell us about you|introduce yourself/],
  ["city", /\bcity\b|where do you live|current location|^location$/],
  ["location", /relocat|\bremote\b|work location|location preference/],
];

const RESUME = /resume|\bcv\b|curriculum vitae/;
const COVER = /cover letter/;
const PREFERRED_NAME = /preferred (first )?name/;

/** The most choices of one question kept with the packet. */
const MAX_OPTIONS = 200;
/** The packet must fit its database column (64 KB); this leaves room. */
export const MAX_PACKET_CHARS = 48_000;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The one option of a select that means `yes` or `no`, or null when that is not plain: no such
 * option, or several ("Yes - I work here now", "Yes - I worked here before").
 */
function yesNoOption(options: FormQuestion["options"], answer: "yes" | "no"): { label: string; value: string } | null {
  const hits = (options ?? []).filter((o) => new RegExp(`^${answer}\\b`, "i").test(o.label.trim()));
  return hits.length === 1 ? hits[0]! : null;
}

/** A question about your gender (not pronouns, orientation or transgender status, which stay unanswered). */
const GENDER = /\bgender\b|\bsex\b/;
const NOT_GENDER = /pronoun|orientation|transgender/;
const GENDER_LABEL = { male: /^(male|man)\b/i, female: /^(female|woman)\b/i, nonbinary: /^non[- ]?binary\b/i } as const;
const GENDER_TEXT = { male: "Male", female: "Female", nonbinary: "Non-binary" } as const;

/**
 * Your own Gender answer as this form can take it: the one choice that says it plainly, or the
 * word itself in a text box. Null when you set none, or when the form's choices do not have
 * exactly one that matches: then the question is declined like any other demographic one.
 */
function genderChoice(q: FormQuestion, gender: Eligibility["gender"]): { label: string; value?: string } | null {
  if (!gender) return null;
  if (q.kind === "text" || q.kind === "textarea") return { label: GENDER_TEXT[gender] };
  const hits = (q.options ?? []).filter((o) => GENDER_LABEL[gender].test(o.label.trim()));
  return hits.length === 1 ? hits[0]! : null;
}

/** "I don't wish to answer" and the like, when a demographic question offers it. */
const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|choose not/i;

export interface PacketInput {
  questions: readonly FormQuestion[];
  /** Your answer bank, by question id (Settings.careerAnswers). */
  answers: Record<string, string> | undefined;
  eligibility: Eligibility | undefined;
  /** Your fixed profile answers (Settings.careerProfile): phone code, country, city, education. */
  profile?: Partial<FormProfile>;
  job: { company: string; role: string };
  /** True when the role's resume PDF is ready (copied from Notion and kept). */
  resumeReady: boolean;
}

/**
 * The packet for one form. Only answers you wrote, or your fixed eligibility answers, are
 * used; a starter text is never sent. A required question nobody may answer is a stop.
 */
export function buildPacket(input: PacketInput): Packet {
  const saved = input.answers ?? {};
  const own = (id: string) => (saved[id] ?? "").trim();
  const name = splitName(own("fullName"));
  const links = splitLinks(own("links"));
  const bank: Record<string, string> = {
    fullName: own("fullName"),
    ...name,
    email: own("email"),
    phone: own("phone"),
    city: own("city"),
    ...links,
    location: own("location"),
    startDate: own("startDate"),
    salary: own("salary"),
    yearsExperience: own("yearsExperience"),
    intro: own("intro"),
    whyCompany: own("whyCompany"),
    whyLooking: own("whyLooking"),
    project: own("project"),
    aiExperience: own("aiExperience"),
    workHistory: own("workHistory"),
    heardFrom: own("heardFrom"),
  };

  const profile = profileOf(input.profile, bank.city);

  const items: PacketItem[] = [];
  const stops: string[] = [];
  const toDraft: string[] = [];
  const stop = (q: FormQuestion, why: string, locked = false) => {
    items.push({ name: q.name, label: q.label.slice(0, 300), required: q.required, kind: q.kind, source: "none", value: "", ...(q.options?.length ? { options: q.options.slice(0, MAX_OPTIONS) } : {}), ...(locked ? { locked: true } : {}) });
    if (q.required) stops.push(`"${q.label.slice(0, 80)}" ${why}`);
  };

  for (const q of input.questions) {
    const t = words(q.label);
    // A select keeps the form's choices, so you can change the pick in the review.
    const base = { name: q.name, label: q.label.slice(0, 300), required: q.required, kind: q.kind, ...((q.kind === "select" || q.kind === "multiselect") && q.options?.length ? { options: q.options.slice(0, MAX_OPTIONS) } : {}) };

    if (q.kind === "file") {
      if (RESUME.test(t)) {
        if (input.resumeReady) items.push({ ...base, source: "resume", value: "" });
        else stop(q, "needs the resume PDF, which is not ready");
      } else stop(q, COVER.test(t) ? "asks for a cover letter file" : "asks for a file Atlas does not have");
      continue;
    }

    const elig = ELIGIBILITY.find(([, re]) => re.test(t));
    if (elig) {
      const answer = input.eligibility?.[elig[0]] ?? "";
      if (!answer) {
        stop(q, "is an eligibility question you have not answered in Settings");
        continue;
      }
      if (q.kind === "select" || q.kind === "multiselect") {
        const opt = yesNoOption(q.options, answer);
        if (opt) items.push({ ...base, source: "eligibility", value: opt.label, optionValue: opt.value });
        else stop(q, "has options that are not a plain Yes or No");
      } else items.push({ ...base, source: "eligibility", value: answer === "yes" ? "Yes" : "No" });
      continue;
    }

    if (DEMOGRAPHIC.test(t)) {
      // Gender is the one demographic question you may answer for yourself, in your fixed answers.
      const mine = GENDER.test(t) && !NOT_GENDER.test(t) ? genderChoice(q, input.eligibility?.gender) : null;
      if (mine) {
        items.push({ ...base, source: "eligibility", value: mine.label, ...(mine.value === undefined ? {} : { optionValue: mine.value }) });
        continue;
      }
      const decline = (q.options ?? []).find((o) => DECLINE.test(o.label));
      if (decline) items.push({ ...base, source: "none", value: decline.label, optionValue: decline.value, locked: true });
      else stop(q, "is a demographic question Atlas never answers", true);
      continue;
    }
    if (NEVER.test(t)) {
      stop(q, "is a question Atlas never answers", true);
      continue;
    }

    // Your fixed profile answers: phone code, country, city, school, degree, discipline, graduation year.
    const pf = q.kind === "checkbox" ? null : profileField(t, q.name);
    if (pf) {
      if (q.kind === "select" || q.kind === "multiselect") {
        const opt = profileOption(pf, profile, q.options ?? []);
        if (opt) items.push({ ...base, source: "eligibility", value: opt.label, optionValue: opt.value });
        else stop(q, profile[pf] ? `offers choices, and none is your ${PROFILE_LABEL[pf].toLowerCase()}` : `needs your ${PROFILE_LABEL[pf].toLowerCase()} in Settings`);
      } else {
        const value = profileText(pf, profile, q.kind);
        if (value) items.push({ ...base, source: "eligibility", value });
        else stop(q, `needs your ${PROFILE_LABEL[pf].toLowerCase()} in Settings`);
      }
      continue;
    }

    if (q.kind === "typeahead") {
      // Any other place a search box asks for: where you live.
      if (profile.city) items.push({ ...base, source: "eligibility", value: profile.city });
      else stop(q, "needs your city in Settings");
      continue;
    }

    if (PREFERRED_NAME.test(t)) {
      if (bank.firstName) items.push({ ...base, source: "bank", value: bank.firstName });
      else stop(q, "needs your name in the answer bank");
      continue;
    }

    const field = BANK.find(([, re]) => re.test(t))?.[0];
    if (field && (q.kind === "text" || q.kind === "textarea")) {
      const value = fillAnswer(bank[field] ?? "", input.job);
      if (value) items.push({ ...base, source: "bank", value });
      else stop(q, "has no answer in your answer bank yet");
      continue;
    }
    // The same question asked as a list: your saved answer is used only when it is, word for
    // word, exactly one of the form's choices. Otherwise you pick in the review.
    if (field && (q.kind === "select" || q.kind === "multiselect")) {
      const saved = (bank[field] ?? "").trim().toLowerCase();
      const hits = saved ? (q.options ?? []).filter((o) => o.label.trim().toLowerCase() === saved) : [];
      if (hits.length === 1) items.push({ ...base, source: "bank", value: hits[0]!.label, optionValue: hits[0]!.value });
      else stop(q, saved ? "offers choices, and your saved answer is not one of them" : "is a question with no approved answer");
      continue;
    }

    // An open question of the form's own: Gemini drafts it from your resumes, and you review it.
    if (q.kind === "textarea" || (q.kind === "text" && q.required)) {
      if (q.required) toDraft.push(q.label.slice(0, 300));
      items.push({ ...base, source: "ai", value: "" });
      if (q.required) stops.push(`"${q.label.slice(0, 80)}" needs an answer drafted from your resume`);
      continue;
    }

    // An optional question nobody answers is left blank; a required one stops the run.
    stop(q, "is a question with no approved answer");
  }
  return { items, stops, toDraft };
}

/** True when the packet can be submitted once you approve it: nothing stops it. */
export const packetReady = (p: Pick<Packet, "stops">): boolean => p.stops.length === 0;

// ---------------------------------------------------------------------------
// After your review

/**
 * What still stands between a packet and submitting it, after your edits in the review. A
 * locked question that is required means you apply yourself; any other required question
 * without an answer needs yours. Checked when you approve and again before the agent submits.
 */
export function packetProblems(items: readonly PacketItem[], resumeReady: boolean): { blocked: string[]; needsYou: string[] } {
  const blocked: string[] = [];
  const needsYou: string[] = [];
  for (const i of items) {
    if (!i.required) continue;
    const label = `"${i.label.slice(0, 80)}"`;
    if (i.locked && !i.value) blocked.push(`${label} is a question Atlas never answers: apply to this one yourself`);
    else if (i.kind === "file") {
      if (i.source !== "resume") (RESUME.test(words(i.label)) ? needsYou : blocked).push(RESUME.test(words(i.label)) ? `${label} needs the resume PDF, which is not ready: prepare this application again` : `${label} asks for a file Atlas does not have`);
      else if (!resumeReady) needsYou.push(`${label} needs the resume PDF, which is not ready`);
    } else if (!i.value.trim()) needsYou.push(`${label} needs an answer`);
    else if ((i.kind === "select" || i.kind === "multiselect") && i.options?.length && !i.options.some((o) => o.label === i.value)) needsYou.push(`${label} needs one of the form's own choices`);
  }
  return { blocked, needsYou };
}

/**
 * Your edit to one answer in the review. You may change any answer except a locked one; for a
 * select, only to one of the form's own choices. The edited answer is then yours ("you").
 */
export function editAnswer(items: readonly PacketItem[], name: string, value: string): PacketItem[] | null {
  const at = items.findIndex((i) => i.name === name);
  const item = items[at];
  if (!item || item.locked || item.kind === "file") return null;
  const text = value.replace(/\u0000/g, "").trim().slice(0, 4000);
  let next: PacketItem;
  if (item.kind === "select" || item.kind === "multiselect") {
    const opt = (item.options ?? []).find((o) => o.label === text);
    if (!opt && text !== "") return null;
    next = { ...item, source: text ? "you" : "none", value: opt?.label ?? "", ...(opt ? { optionValue: opt.value } : {}) };
    if (!opt) delete next.optionValue;
  } else next = { ...item, source: text ? "you" : "none", value: text };
  return items.map((i, n) => (n === at ? next : i));
}

/**
 * The packet, small enough to store. A form with very long choice lists (every country, twice)
 * loses the choices of questions that are optional and unanswered first, then of answered ones:
 * the answers themselves are never cut.
 */
export function fitPacket(items: readonly PacketItem[]): PacketItem[] {
  const size = (list: readonly PacketItem[]) => JSON.stringify(list).length;
  let out = [...items];
  const drop = (when: (i: PacketItem) => boolean) => {
    for (let n = out.length - 1; n >= 0 && size(out) > MAX_PACKET_CHARS; n--) {
      const i = out[n]!;
      if (!i.options || !when(i)) continue;
      const { options: _options, ...rest } = i;
      out = out.map((x, at) => (at === n ? rest : x));
    }
  };
  drop((i) => !i.required && !i.value);
  drop((i) => Boolean(i.value));
  drop(() => true);
  return out;
}
