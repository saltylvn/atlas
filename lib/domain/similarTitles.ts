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
const UPPER = new Set(["ai", "ml", "fde", "llm", "api", "saas", "aws", "gcp", "ui", "ux", "qa", "sre", "it", "us"]);
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
  return titleCase(cut.toLowerCase()).slice(0, 80);
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
