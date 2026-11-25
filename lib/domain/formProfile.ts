// Your fixed profile answers for application forms: the phone number's country code, your
// country, city, school, degree, discipline and graduation year. Typed once in Settings and
// used as written by Atlas Autofill and the Apply Agent (owner's request, 23 Nov 2026). Pure.
//
// A form asks these in a text box, a list, or a search box. In a box the answer is typed as
// saved. In a list, Atlas picks the choice that says the same thing ("United States" or, failing
// that, "USA"; "Bachelor of Science" or "Bachelor's Degree"); when no choice does, it leaves the
// question for you rather than pick a near miss.

import type { PacketItem } from "./types";

export interface FormProfile {
  /** The phone number's country calling code, digits only: "1". */
  phoneCode: string;
  country: string;
  city: string;
  school: string;
  degree: string;
  /** Field of study, major. */
  discipline: string;
  /** Year you graduated (or will): "2025". */
  gradYear: string;
}
export type ProfileField = keyof FormProfile;

/** Before you save any: the country and its calling code; the rest waits for you. */
export const DEFAULT_PROFILE: FormProfile = { phoneCode: "1", country: "United States", city: "", school: "", degree: "", discipline: "", gradYear: "" };

export const PROFILE_LABEL: Record<ProfileField, string> = {
  phoneCode: "Phone country code",
  country: "Country",
  city: "City",
  school: "School",
  degree: "Degree",
  discipline: "Discipline (field of study)",
  gradYear: "Graduation year",
};

/** Your saved profile over the defaults; the city falls back to the answer bank's. */
export function profileOf(saved: Partial<FormProfile> | undefined, bankCity = ""): FormProfile {
  const p = { ...DEFAULT_PROFILE };
  for (const k of Object.keys(p) as ProfileField[]) {
    const v = String(saved?.[k] ?? "").trim();
    if (v) p[k] = v;
  }
  if (!p.city) p.city = bankCity.trim();
  return p;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, "");

/** Questions about where you are from or may work, not where you live: never a profile answer. */
const NOT_RESIDENCE = /citizen|nationalit|passport|\bbirth|\bborn\b|authori[sz]|eligible|sponsor|visa/;
const EDUCATION_CONTEXT = /educat|school|degree|universit|college|academic/;

/**
 * Which profile answer a question asks for, from its label (`t`, already in plain words) and the
 * form's own field name, or null. Most specific first: the phone's country code before country.
 */
export function profileField(t: string, name = ""): ProfileField | null {
  const n = words(name);
  if (/country code|dial(ing)? code|calling code|(phone|mobile|cell)( number)? country|country (for|of) (your )?(phone|mobile)/.test(t)) return "phoneCode";
  if (/\bcountry\b/.test(t) && !NOT_RESIDENCE.test(t)) return "country";
  if (/\bmonth\b/.test(t)) return null;
  if (/graduat(ion|ed|e)? (date|year)|year of graduation|expected graduation|when did you graduate|year (you )?graduated/.test(t)) return "gradYear";
  if (/^(end|to|completion|finish)( date)?( year)?$|^end year$/.test(t) && (EDUCATION_CONTEXT.test(n) || EDUCATION_CONTEXT.test(t))) return "gradYear";
  if (/^(school|university|college|institution)( name)?$|school or university|(school|university|college|institution) name|name of (your )?(school|university|college|institution)|(which|what) (school|university|college) did you/.test(t)) return "school";
  if (/^degree( type| level| earned| obtained| received)?$|highest (level of )?(education|degree)|level of education|education level|type of degree/.test(t)) return "degree";
  if (/discipline|field of study|area of study|program of study|course of study|^major$|^concentration$|\byour major\b|what (was|is) your major/.test(t)) return "discipline";
  if (/\bcity\b|where do you live|current location|^location$/.test(t)) return "city";
  return null;
}

type Option = { label: string; value: string };

const US = /^(united states( of america)?|usa|us|u s a?)$/;
const US_NAMES = ["United States", "United States of America", "USA", "US", "U.S.", "U.S.A."];
const DEGREE_NAMES: [RegExp, string[]][] = [
  [/^bachelor of science$|^bs$|^bsc$/, ["Bachelor of Science", "Bachelor of Science (BS)", "Bachelor of Science (B.S.)", "BS", "B.S.", "BSc", "Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors", "Bachelor Degree", "Bachelor"]],
  [/^bachelor of arts$|^ba$/, ["Bachelor of Arts", "Bachelor of Arts (BA)", "Bachelor of Arts (B.A.)", "BA", "B.A.", "Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors", "Bachelor Degree", "Bachelor"]],
];

/** What else a list may call your answer, in order of preference: your words first. */
function namesFor(field: ProfileField, wanted: string): string[] {
  const w = words(wanted);
  if (field === "country" && US.test(w)) return [wanted, ...US_NAMES];
  if (field === "degree") return [wanted, ...(DEGREE_NAMES.find(([re]) => re.test(w))?.[1] ?? [])];
  return [wanted];
}

const shortest = (xs: Option[]) => xs.slice().sort((a, b) => a.label.length - b.label.length)[0] ?? null;

/** The phone code's choice: "+1" for your country ("United States (+1)"), or a bare "+1". Never another country's +1. */
function codeOption(options: Option[], code: string, country: string): Option | null {
  const withCode = options.filter((o) => new RegExp(`\\+\\s?${code}(?!\\d)`).test(o.label) || words(o.label) === code);
  const names = namesFor("country", country).map(words).filter(Boolean);
  const yours = withCode.filter((o) => {
    const ow = ` ${words(o.label)} `;
    return names.some((nm) => ow.includes(` ${nm} `));
  });
  if (yours.length) return shortest(yours);
  const bare = withCode.filter((o) => /^\+?\s?\d+$/.test(o.label.trim()));
  return bare.length === 1 ? bare[0]! : null;
}

/**
 * The one choice of a list that says your answer, or null. First the choice that is word for
 * word one of your answer's names, in order of preference; then, for a place, a school subject
 * or a degree, the shortest choice that starts with your answer ("Salt Lake City, UT").
 */
export function profileOption(field: ProfileField, profile: FormProfile, options: readonly Option[]): Option | null {
  const opts = options.filter((o) => o.label.trim());
  if (field === "phoneCode") return codeOption(opts, profile.phoneCode, profile.country);
  const wanted = profile[field];
  if (!wanted) return null;
  if (field === "gradYear") return opts.find((o) => words(o.label) === wanted) ?? null;
  const names = namesFor(field, wanted);
  for (const nm of names) {
    const hits = opts.filter((o) => compact(o.label) === compact(nm));
    if (hits.length) return hits[0]!;
  }
  // The same words with more after them. A country only with its calling code after it, so
  // "United States" never becomes "United States Minor Outlying Islands".
  for (const nm of names) {
    const w = words(nm);
    // A one-word degree ("Bachelor", "BS") starts too many choices to mean yours.
    if (field === "degree" && w.split(" ").length < 2) continue;
    const hits = opts.filter((o) => {
      const ow = words(o.label);
      if (!ow.startsWith(`${w} `)) return false;
      return field === "country" ? /^\+?\d/.test(ow.slice(w.length + 1)) : field !== "school";
    });
    if (hits.length) return shortest(hits);
  }
  return null;
}

/** The answer typed in a box, or in a search box before its suggestion is picked. */
export function profileText(field: ProfileField, profile: FormProfile, kind: PacketItem["kind"]): string {
  if (field === "phoneCode") return kind === "typeahead" ? profile.country : profile.phoneCode ? `+${profile.phoneCode}` : "";
  return profile[field];
}
