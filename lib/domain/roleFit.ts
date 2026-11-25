// The role fit study (19 November 2026): 17 job postings Tyler saved, each scored against
// his projects and Waystar work, grouped into four kinds of role. The full study, with the
// posting text and a requirement-by-requirement table for each, is the Ideal Role Mentoring
// page in Notion. This file keeps the summary the Career Mentor reads and the Target Roles tab shows.
// Fit scores are Claude's judgment of requirements met, 0 to 100: a guide, not a measurement.

export interface StudiedPosting {
  title: string;
  company: string;
  /** 0 to 100. */
  fit: number;
  /** Years of experience asked for, or null when the posting states none. */
  years: number | null;
}

export interface RoleGroup {
  rank: 1 | 2 | 3 | 4;
  name: string;
  /** What the job is, in one line. */
  is: string;
  stance: "target" | "stretch" | "fallback";
  /** Titles that fall in this group. */
  titles: string[];
  postings: StudiedPosting[];
  /** Projects to lead with, strongest first. */
  leadWith: string[];
}

export interface FitGap {
  rank: number;
  gap: string;
  /** How many of the first ten postings asked for it. */
  askedIn: number;
  /** The step that closes it. */
  close: string;
}

export const ROLE_FIT = {
  on: "2026-11-19",
  postings: 17,
  notion: "https://app.notion.com/p/41ea12ce44918111bd14c4f5c0501c78",
  groups: [
    {
      rank: 1,
      name: "Internal AI and Automation Engineer",
      is: "Builds agents and automations for the company's own teams.",
      stance: "target",
      titles: ["AI Automation Engineer", "Business Automation Engineer", "Developer, AI Solutions", "AI Integration Developer", "Internal AI Engineer"],
      postings: [
        { title: "Junior AI and Automation Engineer", company: "Myriad360", fit: 88, years: 0 },
        { title: "Developer, AI Solutions", company: "11:11 Systems", fit: 78, years: 3 },
        { title: "Business Automation Engineer", company: "Blend", fit: 72, years: 3 },
        { title: "AI Integration Developer", company: "Resolut", fit: 62, years: null },
        { title: "AI Solutions Engineer", company: "Havenpark", fit: 60, years: 5 },
      ],
      leadWith: ["Handoff", "Atlas", "Benchmark"],
    },
    {
      rank: 2,
      name: "Customer-facing AI Solutions Engineer",
      is: "Puts AI agents into customers' systems and scopes the work with them.",
      stance: "target",
      titles: ["AI Solutions Engineer", "Agent Engineer", "Forward Deployed Engineer", "Integrations Engineer, AI Services", "Agent Architect", "AI Workflow Engineer (implementation)", "AI Project Manager"],
      postings: [
        { title: "Agent Engineer", company: "Wisq", fit: 80, years: 2 },
        { title: "AI Solutions Engineer", company: "xCures", fit: 76, years: 3 },
        { title: "AI Workflow Engineer", company: "Basata", fit: 68, years: 5 },
        { title: "Senior Agent Architect", company: "Parloa", fit: 58, years: 3 },
        { title: "Integrations Engineer, AI Services", company: "Virtuous", fit: 52, years: 5 },
        { title: "AI Solutions Architect", company: "(not captured)", fit: 30, years: 7 },
        { title: "Integration Architect", company: "Slalom", fit: 20, years: 10 },
      ],
      leadWith: ["Waystar integrations", "Handoff", "Atlas"],
    },
    {
      rank: 3,
      name: "Agentic or AI Software Engineer",
      is: "Builds a product's AI features, or ships product code by directing AI coding agents.",
      stance: "stretch",
      titles: ["Agentic Engineer", "AI Software Engineer", "Applied AI Engineer"],
      postings: [
        { title: "Sr. Agentic Engineer", company: "BambooHR", fit: 45, years: 5 },
        { title: "Senior Applied AI Engineer", company: "Outsmart", fit: 32, years: 5 },
      ],
      leadWith: ["Atlas", "Dialed Kitchen", "DEVELOP"],
    },
    {
      rank: 4,
      name: "Software Engineer",
      is: "General backend or full-stack work, no AI required.",
      stance: "fallback",
      titles: ["Software Engineer", "Full Stack Engineer", "Backend Engineer"],
      postings: [
        { title: "Software Engineer (Junior / Mid-Level)", company: "Pura", fit: 66, years: 1 },
        { title: "Associate Developer, Business Central", company: "JourneyTeam", fit: 40, years: null },
        { title: "JR Software Engineer", company: "KBR", fit: 10, years: 0 },
      ],
      leadWith: ["Dialed Kitchen", "DEVELOP", "Handoff"],
    },
  ] satisfies RoleGroup[],
  gaps: [
    { rank: 1, gap: "Years of paid experience", askedIn: 7, close: "Reframe the Waystar bullets as integration and automation work (no metrics needed)." },
    { rank: 2, gap: "Cloud (AWS, Azure or GCP)", askedIn: 6, close: "Deploy Handoff on AWS with infrastructure as code, logs and an alarm. The free tier needs a card on file, so it is Tyler's call." },
    { rank: 3, gap: "An MCP server of my own", askedIn: 3, close: "Build the Atlas MCP server: read-only tools over Atlas data, least privilege, tests." },
    { rank: 4, gap: "Enterprise identity (SSO, SAML, SCIM)", askedIn: 2, close: "Add single sign-on, SCIM provisioning and role-aware retrieval to one project." },
    { rank: 5, gap: "Production operations", askedIn: 5, close: "Add error tracking, a metrics dashboard and one alert to a live project." },
    { rank: 6, gap: "A named data pipeline", askedIn: 5, close: "Build a small extract, transform, load job with a schedule and validation." },
  ] satisfies FitGap[],
  filters: [
    "Skip postings that require an active security clearance.",
    "Prefer postings asking 2 to 3 years, or none stated.",
    "Pay floor $90K, target $100K or more; check base against variable pay.",
  ],
} as const;

const best = (g: RoleGroup) => [...g.postings].sort((a, b) => b.fit - a.fit);

/** The top fit among a group's postings, or 0. */
export const topFit = (g: RoleGroup): number => best(g)[0]?.fit ?? 0;

/** The average of a group's three best fits, rounded. */
export function topThreeAverage(g: RoleGroup): number {
  const top = best(g).slice(0, 3);
  return top.length ? Math.round(top.reduce((s, p) => s + p.fit, 0) / top.length) : 0;
}

/** Every studied posting, best fit first. */
export const rankedPostings = (): (StudiedPosting & { group: string })[] =>
  ROLE_FIT.groups.flatMap((g) => g.postings.map((p) => ({ ...p, group: g.name }))).sort((a, b) => b.fit - a.fit);

/**
 * The study as plain text for the Career Mentor, under 1,500 characters. Each number in it can be
 * cited, since insights are checked against the material they were shown.
 */
export function roleFitBrief(): string {
  const groups = ROLE_FIT.groups.map((g) => `${g.rank}. ${g.name} (${g.stance}). Best: ${best(g).slice(0, 2).map((p) => `${p.company} ${p.fit}`).join(", ")}. Lead with ${g.leadWith.join(", ")}.`);
  const gaps = ROLE_FIT.gaps.map((g) => `${g.rank}. ${g.gap}`).join("; ");
  return [`Role fit study of ${ROLE_FIT.on}, from ${ROLE_FIT.postings} saved postings. Fit is 0 to 100.`, "Role groups, in order:", ...groups, `Gaps to close, in order: ${gaps}. Waystar is reframed as integration and automation work, without metrics.`, `Filters: ${ROLE_FIT.filters.join(" ")}`].join("\n");
}
