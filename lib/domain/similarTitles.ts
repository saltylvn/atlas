// "Similar job titles" for each of your target roles: the real titles the Career
// Agent's searches matched to that role, cleaned up and counted, so you can see what
// each role is called out there. Pure: the page passes the stored matches in.

import type { TargetRole } from "./targetRoles";
import type { Application, JobMatch } from "./types";

export interface SimilarTitle {
  title: string;
  /** How many matched postings used this title. */
  count: number;
  /** The newest posting with this title (ISO). */
  lastSeen: string;
}

export interface RoleTitles {
  role: TargetRole;
  /** The title phrases Atlas searches for, as readable titles. */
  searchedFor: string[];
  /** Real titles found across your job searches, most common first. */
  similar: SimilarTitle[];
  /** Postings matched to this role so far, and applications on the board for it. */
  matches: number;
  applications: number;
}

const SMALL = new Set(["and", "or", "of", "the", "for", "to", "in", "at", "with"]);
const UPPER = new Set(["ai", "ml", "fde", "llm", "api", "saas", "aws", "gcp", "ui", "ux", "qa", "sre", "it", "us", "gtm", "iot"]);
const SPECIAL: Record<string, string> = { genai: "GenAI", devops: "DevOps", mlops: "MLOps", typescript: "TypeScript", javascript: "JavaScript" };
const word = (w: string) => SPECIAL[w.toLowerCase()] ?? (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

/** "ai ml engineer" -> "AI ML Engineer". */
export function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.split("-").map(word).join("-")))
    .join(" ");
}

/**
 * The core of a posting title: "Senior Software Engineer — Kubernetes Control Plane"
 * -> "Senior Software Engineer"; "Solutions Architect - Digital Native Business (DNB)"
 * -> "Solutions Architect"; "Full Stack Engineer (TypeScript/React/Node)" -> "Full Stack
 * Engineer". Team names, tech stacks and locations after a separator are dropped.
 */
export function coreTitle(raw: string): string {
  const cut = raw
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/\s[|–—-]\s|,|\s\/\s|:|\s@\s/)[0]!
    .replace(/[^A-Za-z0-9+&/ .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A level written as a Roman numeral stays one: "Engineer II", not "Engineer Ii".
  return titleCase(cut.toLowerCase()).replace(/\b(Ii|Iii|Iv)\b/g, (n) => n.toUpperCase()).slice(0, 80);
}

export function roleTitles(roles: TargetRole[], matches: Pick<JobMatch, "title" | "role" | "postedAt" | "createdAt">[], apps: Pick<Application, "targetRole">[] = [], perRole = 15): RoleTitles[] {
  return roles.map((role) => {
    const mine = matches.filter((m) => m.role === role.name);
    const counts = new Map<string, SimilarTitle>();
    for (const m of mine) {
      const title = coreTitle(m.title);
      if (title.length < 3) continue;
      const key = title.toLowerCase();
      const seen = m.postedAt ?? m.createdAt;
      const prev = counts.get(key);
      if (prev) {
        prev.count += 1;
        if (seen > prev.lastSeen) prev.lastSeen = seen;
      } else counts.set(key, { title, count: 1, lastSeen: seen });
    }
    return {
      role,
      searchedFor: [...new Set(role.titles.map((t) => titleCase(t)))],
      similar: [...counts.values()].sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen) || a.title.localeCompare(b.title)).slice(0, perRole),
      matches: mine.length,
      applications: apps.filter((a) => a.targetRole === role.name).length,
    };
  });
}

export interface FamilyTitle {
  title: string;
  /** Postings seen with this title, 0 for a title Atlas searches for but has not found yet. */
  count: number;
  /** Where it comes from: real postings, or Atlas's own search list for the role. */
  from: "postings" | "searched";
}

/** One key for spellings of a title: "Full Stack" and "Fullstack", "Solution" and "Solutions", "AI and Automation" and "AI Automation", "Go to Market" and "GTM". */
const spelling = (s: string) => s.toLowerCase().replace(/\bgo[\s-]*to[\s-]*market\b/g, "gtm").replace(/\band\b|&/g, "").replace(/[^a-z0-9]+/g, "").replace(/s(?=engineer|developer|architect)/g, "");
/** The role's own name, or a spelling of it. */
const SAME_ROLE = (title: string, role: string) => spelling(title) === spelling(role);
/** A title worth listing: two words or more, naming a kind of job. */
const IS_TITLE = (t: string) => t.split(" ").length >= 2 && /\b(engineer|architect|developer|consultant|advocate|evangelist)\b/i.test(t);

/**
 * The other names a target role goes by: of the title phrases that count as the role, the
 * ones its postings (job-board postings and job-search matches, together) used most, each
 * posting counted under the longest phrase it matched, without the role's own name. Company
 * and team words in a title ("Feltsense AI Engineer") do not make a new name. When postings
 * show fewer than `n`, the role's other phrases fill in, marked as searched for. Pure.
 */
export function similarTitlesFor(role: TargetRole, postings: readonly { title: string; role: string }[], n = 4): FamilyTitle[] {
  const pad = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const phrases = role.titles.map((t) => ({ title: titleCase(t), at: pad(t) })).filter((p) => IS_TITLE(p.title) && !SAME_ROLE(p.title, role.name));
  const counts = new Map<string, FamilyTitle>();
  for (const p of postings) {
    if (p.role !== role.name) continue;
    const t = pad(p.title);
    const hit = phrases.filter((x) => t.includes(x.at)).sort((a, b) => b.at.length - a.at.length)[0];
    // A posting whose best match is the role's own name ("Senior Solutions Engineer") is not another name.
    const own = pad(role.name);
    if (!hit || (t.includes(own) && own.length >= hit.at.length)) continue;
    const key = spelling(hit.title);
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { title: hit.title, count: 1, from: "postings" });
  }
  const found = [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, n);
  const have = new Set(found.map((f) => spelling(f.title)));
  for (const p of phrases) {
    if (found.length >= n) break;
    if (have.has(spelling(p.title))) continue;
    have.add(spelling(p.title));
    found.push({ title: p.title, count: 0, from: "searched" });
  }
  return found;
}
