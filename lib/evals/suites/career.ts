import { jobType, parsePay, payFits, roleFor, titleLevel, whereFits } from "@/lib/domain/careerAgent";
import { isDemoOnly } from "@/lib/domain/careerDirection";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { EvalCase, EvalSuite } from "../types";

const roles = [...TARGET_ROLES];
const prefs = { minSalary: 120_000, minRate: 50 };
const SKIP = "skip";

/** [job title as posted, the target role it belongs to, or skip] */
const TITLES: [string, string][] = [
  // Forward Deployed
  ["Forward-Deployed Product Engineer", "Forward Deployed Engineer"],
  ["Forward Deployed Engineer, Applied AI", "Forward Deployed Engineer"],
  ["Agent Deployment Engineer", "Forward Deployed Engineer"],
  ["FDE (Forward Deployed Engineer) | Remote US | $160k-$200k", "Forward Deployed Engineer"],
  // AI Workflow / AI Agent
  ["AI Agent Engineer", "AI Workflow Engineer"],
  ["Senior Agentic AI Engineer NDA", "AI Workflow Engineer"],
  ["Agentic Python Engineer", "AI Workflow Engineer"],
  ["Workflow Automation Engineer", "AI Workflow Engineer"],
  // Solutions
  ["Solutions Engineer", "Solutions Engineer"],
  ["AI Solutions Engineer", "Solutions Engineer"],
  ["AWS Cloud Solutions Architect", "Solutions Engineer"],
  ["Senior Solutions Engineer, Digital Native and Mid-Market", "Solutions Engineer"],
  ["Customer Solutions Engineer, EMEA", "Solutions Engineer"],
  ["Sales Engineer", "Solutions Engineer"],
  // AI + Automation
  ["AI Automation Engineer", "AI + Automation Engineer"],
  ["Internal AI Engineer", "AI + Automation Engineer"],
  ["Intelligent Automation Developer", "AI + Automation Engineer"],
  // GTM
  ["GTM Engineer", "GTM Engineer"],
  ["Go-to-Market Engineer", "GTM Engineer"],
  ["Revenue Operations Engineer", "GTM Engineer"],
  // AI Engineer
  ["Applied AI Engineer", "AI Engineer"],
  ["Founding AI Engineer", "AI Engineer"],
  ["AI ML Engineer", "AI Engineer"],
  // Software Engineer (the generic role always comes last)
  ["Full Stack Engineer (TypeScript/React/Node)", "Software Engineer"],
  ["Backend Engineer, AI Coding Task Design", "Software Engineer"],
  ["Software Engineer (L4)", "Software Engineer"],
  // Integration Engineer is Solutions Engineer under another name
  ["Integration Engineer", "Solutions Engineer"],
  ["Integrations Engineer II", "Solutions Engineer"],
  ["API Integration Engineer", "Solutions Engineer"],
  // Skipped: too senior, not engineering, or not a real opening
  ["Staff Software Engineer", SKIP],
  ["Principal AI Engineer", SKIP],
  ["Engineering Manager, AI Platform", SKIP],
  ["Director of Solutions Engineering", SKIP],
  ["QA Automation Engineer", SKIP],
  ["Test Automation Engineer", SKIP],
  ["Paid AI Engineering Intern", SKIP],
  ["Software Engineer Interviewer", SKIP],
  ["Marketing Automation Specialist", SKIP],
  ["Data Scientist", SKIP],
];

/** [location text, on a remote-only board?, expected] */
const PLACES: [string, boolean, string][] = [
  ["Remote, US", false, "remote"],
  ["", true, "remote"],
  ["Anywhere", true, "remote"],
  ["Salt Lake City, UT", false, "salt-lake"],
  ["Lehi, Utah (hybrid)", false, "salt-lake"],
  ["Remote (EEA only)", true, SKIP],
  ["EMEA", true, SKIP],
  ["Remote - Canada", true, SKIP],
  ["London, UK", false, SKIP],
  ["New York, NY", false, SKIP],
];

/** [title, posting text, expected: fits or below your floor, and full-time or gig] */
const PAY: [string, string, string][] = [
  ["AI Engineer", "Salary: $120k-$150k", "full-time fits"],
  ["Software Engineer", "$80,000 - $95,000 per year", "full-time below floor"],
  ["Solutions Engineer", "Competitive salary and equity", "full-time fits"],
  ["AI Automation Engineer (Contract)", "$60/hr, 3 months", "gig fits"],
  ["Automation Developer, part-time", "$30 per hour", "gig below floor"],
  // The floor is checked against the base, not the OTE
  ["Solutions Engineer", "OTE $140k ($95k base)", "full-time below floor"],
  ["Solutions Engineer", "OTE $160k ($125k base)", "full-time fits"],
  ["Sales Engineer", "Base salary: $95,000 – $110,000 plus commission", "full-time below floor"],
  ["Solutions Engineer", "$140k - $160k OTE", "full-time fits"],
  ["Solutions Engineer", "$90k - $110k OTE", "full-time below floor"],
];

/** [posting text, what the posted figure covers] */
const BASIS: [string, string][] = [
  ["$120k - $150k", "not said"],
  ["$120k + equity", "not said"],
  ["$120k-$150k, OTE $180k", "not said"],
  ["Base salary: $95,000 – $110,000 plus commission", "base"],
  ["$125,000 plus annual bonus", "base"],
  ["$95k base, OTE $140k", "base"],
  ["OTE $140k ($95k base)", "base"],
  ["$140k - $160k OTE", "variable"],
  ["On-target earnings (OTE) of $150k–$180k", "variable"],
  ["Total compensation: $150k–$190k", "variable"],
  ["$130k including bonus", "variable"],
];

/** [title, how its level reads] */
const LEVEL: [string, string][] = [
  ["Solutions Engineer II", "early"],
  ["Software Engineer I", "early"],
  ["Integration Engineer, Level 2", "early"],
  ["Associate Solutions Engineer", "low"],
  ["Solutions Engineering Specialist", "low"],
  ["Solutions Engineer", "none"],
  ["Software Engineer III", "none"],
  ["Senior Solutions Engineer", "none"],
];

/** [title, posting text, expected] */
const DEMO: [string, string, string][] = [
  ["Solutions Engineer", "Run product demos to prospects, support account executives through the sales cycle, carry a quota.", "demo-only"],
  ["Sales Engineer", "Help the sales team close deals.", "demo-only"],
  ["AI Solutions Engineer", "Implement and deploy AI agents for customers, build integrations with their APIs, ship to production in Python.", "builds"],
  ["Solutions Engineer", "Own technical discovery and demos to prospects during the sales cycle with account executives; then build the integration, write code in Python and deploy to production.", "builds"],
];

const cases: EvalCase[] = [
  ...TITLES.map(([title, expected]): EvalCase => ({ name: `Role · ${title}`, expected, actual: () => roleFor(title, roles)?.name ?? SKIP })),
  ...PLACES.map(([loc, board, expected]): EvalCase => ({ name: `Location · "${loc || "(blank)"}"${board ? " on a remote board" : ""}`, expected, actual: () => whereFits(loc, board) ?? SKIP })),
  ...PAY.map(([title, text, expected]): EvalCase => ({
    name: `Pay · ${title}: ${text}`,
    expected,
    actual: () => {
      const type = jobType({ title, text });
      return `${type} ${payFits(parsePay(`${title} ${text}`), type, prefs) ? "fits" : "below floor"}`;
    },
  })),
  ...DEMO.map(([title, text, expected]): EvalCase => ({ name: `Pre-sales · ${title}: ${text.slice(0, 60)}…`, expected, actual: () => (isDemoOnly(title, text) ? "demo-only" : "builds") })),
  ...BASIS.map(([text, expected]): EvalCase => ({ name: `Base or variable · ${text}`, expected, actual: () => parsePay(text)?.basis ?? "not said" })),
  ...LEVEL.map(([title, expected]): EvalCase => ({ name: `Level · ${title}`, expected, actual: () => titleLevel(title) ?? "none" })),
];

export const careerSuite: EvalSuite = {
  agent: "career",
  title: "Matching jobs to your roles",
  what: "Maps a posted title to one of your seven roles (or skips it), and checks location, pay floor, base against variable pay, the level in a title and demo-only pre-sales.",
  threshold: 0.95,
  cases,
};
