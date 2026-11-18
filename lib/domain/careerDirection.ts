// Tyler's career direction: advice from Fable (13 November 2026), kept here so Atlas, the
// Career Agent and the Target roles tab all work from the same reference. Tyler sets the
// priority order of his own roles in Notion (targetRoles.ts is the fallback); this file
// says how the market ranks and names that work, and what to showcase.
// The numbers come mostly from recruiters and vendors: directional, not exact.

export interface Source {
  label: string;
  url: string;
}

export interface MarketRole {
  rank: number;
  title: string;
  alsoCalled: string[];
  why: string;
  /** What to do about it. */
  tip: string;
  /** Which of your target roles this market title falls under, or null if none. */
  mapsTo: string | null;
  sources: Source[];
}

export interface ShowcaseSkill {
  rank: number;
  name: string;
  how: string;
  /** The Growth page skill (skills.ts) that tracks it in your matched jobs, if any. */
  tracks: string | null;
}

export const CAREER_DIRECTION = {
  from: "Fable",
  on: "2026-11-13",
  edge: "Your profile is strongest where building meets the business: you design agent systems, wire them into real tools, and work with decision-makers. That is where the market is hottest right now.",
  roles: [
    {
      rank: 1,
      title: "Forward Deployed Engineer",
      alsoCalled: ["Agent Deployment Engineer", "Applied AI Engineer"],
      why: "The closest match and the hottest title: Indeed's April 2026 data showed postings up more than 729% year over year, with base pay averaging about $172K.",
      tip: "Expect a coding round plus a scoping case study, sometimes a customer simulation. Aim at AI startups and mid-market companies first; frontier labs weigh deep production coding most.",
      mapsTo: "Forward Deployed Engineer",
      sources: [
        { label: "LeadDev", url: "https://leaddev.com/?p=34647" },
        { label: "Paraform", url: "https://www.paraform.com/insights/forward-deployed-engineer-demand-quadrupled" },
      ],
    },
    {
      rank: 2,
      title: "AI Agent Engineer",
      alsoCalled: ["Agentic AI Engineer"],
      why: "The pure builder version of what you've done. It tops Second Talent's 2026 list of fastest-growing roles.",
      tip: "Lead with Atlas: a supervisor agent routing work to specialists, each with its own tools and logs.",
      mapsTo: "AI Workflow Engineer",
      sources: [{ label: "Second Talent report", url: "https://lifestyle.kbew98country.com/story/220742/10-new-ai-roles-that-didnt-exist-3-years-ago-second-talents-2026-report/" }],
    },
    {
      rank: 3,
      title: "AI Solutions Engineer",
      alsoCalled: ["Implementation", "Internal solutions"],
      why: "The title hides pre-sales, forward-deployed and internal jobs; senior hires are priced at $190K–$260K.",
      tip: "Read each posting and skip the demo-only ones. The Career Agent ranks demo-heavy pre-sales postings well below the rest.",
      mapsTo: "Solutions Engineer",
      sources: [{ label: "KORE1", url: "https://www.kore1.com/hire-ai-solutions-engineers-2026/" }],
    },
    {
      rank: 4,
      title: "AI Automation Engineer",
      alsoCalled: ["Internal AI Engineer"],
      why: "Your \"automations to save time\" pitch, inside one company. Steadier demand: about 194 new US postings a week, most of them junior and mid-level roles.",
      tip: "Bring numbers: hours saved per week, steps removed, cost per run.",
      mapsTo: "AI + Automation Engineer",
      sources: [{ label: "Axial Search", url: "https://axialsearch.com/insights/intelligent-automation-job-demand" }],
    },
    {
      rank: 5,
      title: "GTM Engineer",
      alsoCalled: ["Go-to-market engineer"],
      why: "If you like revenue systems (CRM, enrichment, outbound): a $127.5K median across 1,000+ postings and 205% job growth.",
      tip: "Serious postings ask for API integration, SQL and end-to-end pipeline ownership. Lead with the integrations and data model behind Atlas.",
      mapsTo: "GTM Engineer",
      sources: [
        { label: "Prospeo", url: "https://prospeo.io/s/gtm-engineering" },
        { label: "FirstSales", url: "https://firstsales.io/raw/gtm-engineer-role.md" },
      ],
    },
  ] satisfies MarketRole[],
  skills: [
    { rank: 1, name: "Multi-agent orchestration", how: "Name it in market vocabulary: Atlas's Chief of Staff is a supervisor (hierarchical) pattern.", tracks: "Multi-agent orchestration" },
    { rank: 2, name: "MCP and API integration", how: "List the systems you connected: Gmail, Google Calendar, Notion, Supabase, Vercel, GitHub. MCP showed up in 454 job descriptions in June 2026.", tracks: "MCP" },
    { rank: 3, name: "Evals and observability", how: "The rarest skill: about 89% of teams have observability, only 52% have real evals. Atlas now has both: an eval suite per agent that gates CI, and a step-by-step trace of every run (see Evals). \"How do you know your agents are working?\" will come up.", tracks: "Evals & observability" },
    { rank: 4, name: "Shipping production software with AI coding tools", how: "Show the web app, the SQL and data model, the deployment, and Claude Code as your daily workflow. Describe what you shipped, not which tools you know.", tracks: null },
    { rank: 5, name: "Scoping and stakeholder translation, with numbers", how: "A vague business problem turned into a shipped system, with hours saved, cost cut or cycle time reduced. This separates you from pure coders.", tracks: "Solution architecture" },
  ] satisfies ShowcaseSkill[],
  drop: [
    {
      what: "\"AI fluent\" and \"prompt engineering\" as headline skills",
      why: "In Hacker News job posts, prompt engineering's share fell from about 0.9% to 0.4% during 2026 while evals and MCP overtook it.",
      source: { label: "Level Up Coding", url: "https://levelup.gitconnected.com/the-10-ai-skills-employers-actually-asked-for-in-32-924-hacker-news-job-posts-and-prompt-239a8272445d" },
    },
  ],
  /** How to present yourself (Fable, 18 Nov 2026). The lead title is also the first role in your own order. */
  positioning: {
    on: "2026-11-18",
    lead: "Solutions Engineer",
    why: "Lead with Solutions Engineer: it matches the most postings for what you build, which is integrations, workflow automation and AI agents.",
    notes: [
      "Name the title in the first two lines of your headline and About. Skip \"aspiring\" and \"seeking\": they read as junior.",
      "Say your level without writing \"entry level\", which anchors pay low. \"With senior engineers to learn from\" says entry to mid.",
      "Lead with what you built. Keep your current job to one sentence and put the detail in Experience.",
      "Mention MCP as part of your daily workflow until one of your repos has an MCP server you built. Then it can move into the headline.",
      "At entry to mid level, Specialist and Associate titles usually post below your salary floor. Look for Engineer titles at level I or II, and check whether a posted number is base pay or includes variable pay.",
    ],
  },
  caveat: "Much of this data comes from recruiters and vendors, and growth figures vary by source, so treat the numbers as directional.",
  notion: "https://app.notion.com/p/417a12ce4491815b84bde7014532320e",
} as const;

/** Skills not to lead with on LinkedIn or a resume. */
export const DROP_SKILLS: ReadonlySet<string> = new Set(["Prompt engineering"]);

/** Market titles that fall under one of your target roles, e.g. FDE ← "Agent Deployment Engineer". */
export function marketNamesFor(role: string): string[] {
  return CAREER_DIRECTION.roles.filter((r) => r.mapsTo === role).flatMap((r) => (r.title === role ? [...r.alsoCalled] : [r.title, ...r.alsoCalled])).filter((t) => !/^(implementation|internal solutions)$/i.test(t));
}

// ---------------------------------------------------------------------------
// Demo-only pre-sales postings

const SALES = /\b(quota|quota[- ]carrying|commission|ote|on[- ]target earnings|pre[- ]?sales|presales|sales cycle|sales team|account executives?|close deals|revenue targets?|rfps?|demos? to prospects|product demos?|prospects)\b/gi;
const BUILD = /\b(implement\w*|deploy\w*|build(ing)?|integrat\w*|production|coding|write code|ship(ping)?|automation|agents?|pipelines?|python|typescript|apis?)\b/gi;

/**
 * True for a Solutions Engineer posting that reads as demo-only pre-sales: several sales
 * signals and little building. Fable's advice: skip these, keep the implementation and
 * internal ones. Atlas ranks them lower rather than hiding them.
 */
export function isDemoOnly(title: string, text: string): boolean {
  const t = `${title} ${text}`;
  const sales = new Set((t.match(SALES) ?? []).map((s) => s.toLowerCase())).size;
  const build = new Set((t.match(BUILD) ?? []).map((s) => s.toLowerCase())).size;
  return (/\bsales engineer\b/i.test(title) && build < 3) || (sales >= 3 && build < 3);
}
