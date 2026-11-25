// Which roles to target, and in what order. Pure.
//
//   Analyst   computes an outlook for every role: your target roles and the candidate
//             roles next to them. For each: how much of what its postings ask for you can
//             show (in a GitHub project or a resume), how many postings there are, the
//             trend, the pay, and how your own applications to it have gone.
//   Career Mentor    turns the outlook into a proposal: your roles re-ordered so the one you are
//             most qualified for comes first, the three to focus on now, and at most one
//             candidate role worth adding. A model may judge the order; these rules decide
//             what it is allowed to say and check what it said.
//
// Nothing here changes your roles. A proposal waits for your approval, and only then is
// your order in Atlas changed. At most five roles: an added role takes the last place.

import { daysBetween } from "./dates";
import { MIN_POSTINGS, numbersGrounded, type MarketPosting } from "./market";
import { isShown, type SkillEvidence } from "./portfolio";
import { MAX_ROLES, type TargetRole } from "./targetRoles";
import type { Application, LocalDate } from "./types";

export interface AskedSkill {
  skill: string;
  /** Share of this role's postings that ask for it, 0 to 1. */
  share: number;
  /** A project or a resume of yours shows it. */
  shown: boolean;
  /** The projects that show it, at most three. */
  projects: string[];
}

export interface RoleOutlook {
  role: string;
  /** True for a role on your list; false for a candidate role. */
  target: boolean;
  postings: number;
  thisWeek: number;
  lastWeek: number;
  trend: "up" | "down" | "flat";
  /** Share you could work: remote or Salt Lake. */
  reachable: number;
  payMedian: number | null;
  asked: AskedSkill[];
  /** How much of what the role asks for you can show, 0 to 1, weighted by how often each skill is asked. */
  qualified: number;
  /** Projects of yours that show at least two of the asked skills, best first. */
  projects: string[];
  /** Your applications to this role, and how many drew a reply, interview or offer. */
  applied: number;
  responses: number;
  /** Too few postings to judge: the role keeps its place and is never recommended. */
  thin: boolean;
  /** 0 to 100. Qualification counts most, then demand, then reach and pay. */
  score: number;
}

const WINDOW_DAYS = 30;
const POSITIVE = new Set(["replied", "interview", "offer"]);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2)) : null;
};
const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${Math.round(n / 1000)}k`;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The outlook for each role, targets first in your order, then candidates by score. */
export function roleOutlook(
  postings: readonly MarketPosting[],
  targets: readonly TargetRole[],
  candidates: readonly TargetRole[],
  evidence: ReadonlyMap<string, SkillEvidence>,
  applications: readonly Pick<Application, "targetRole" | "status" | "appliedOn">[],
  today: LocalDate,
  minSalary = 0,
): RoleOutlook[] {
  const recent = postings.filter((p) => daysBetween(p.lastSeen, today) <= WINDOW_DAYS);
  const one = (role: TargetRole, target: boolean): RoleOutlook => {
    const rows = recent.filter((p) => p.role === role.name);
    const thisWeek = rows.filter((p) => daysBetween(p.firstSeen, today) < 7).length;
    const lastWeek = rows.filter((p) => daysBetween(p.firstSeen, today) >= 7 && daysBetween(p.firstSeen, today) < 14).length;
    const counts = new Map<string, number>();
    for (const p of rows) for (const s of new Set(p.skills)) counts.set(s, (counts.get(s) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const askedTotal = ranked.reduce((n, [, c]) => n + c, 0);
    const shownTotal = ranked.filter(([s]) => isShown(evidence.get(s.toLowerCase()))).reduce((n, [, c]) => n + c, 0);
    const asked: AskedSkill[] = ranked.slice(0, 8).map(([skill, c]) => {
      const e = evidence.get(skill.toLowerCase());
      return { skill, share: c / rows.length, shown: isShown(e), projects: (e?.projects ?? []).slice(0, 3) };
    });
    const byProject = new Map<string, number>();
    for (const a of ranked.slice(0, 12)) for (const p of evidence.get(a[0].toLowerCase())?.projects ?? []) byProject.set(p, (byProject.get(p) ?? 0) + 1);
    const pays = rows.filter((p) => p.payUnit === "year" && p.payMin !== null && p.payMax !== null).map((p) => (p.payMin! + p.payMax!) / 2);
    const payMedian = median(pays);
    const sent = applications.filter((a) => a.targetRole === role.name && a.appliedOn && a.status !== "saved");
    const responses = sent.filter((a) => POSITIVE.has(a.status)).length;
    const qualified = askedTotal ? shownTotal / askedTotal : 0;
    const reachable = rows.length ? rows.filter((p) => p.place !== "other").length / rows.length : 0;
    const thin = rows.length < MIN_POSTINGS || ranked.length === 0;
    const trend: RoleOutlook["trend"] = thisWeek + lastWeek < 6 ? "flat" : thisWeek >= lastWeek * 1.3 ? "up" : thisWeek <= lastWeek * 0.7 ? "down" : "flat";
    const demand = Math.min(1, rows.length / 20) * (trend === "up" ? 1 : trend === "down" ? 0.8 : 0.9);
    const worth = reachable * (payMedian === null ? 0.8 : payMedian >= minSalary ? 1 : 0.6);
    // Your own results nudge the score, and only once there are enough to mean something.
    const results = sent.length >= 5 && responses === 0 ? 0.92 : sent.length >= 3 && responses / sent.length >= 0.2 ? 1.08 : 1;
    return {
      role: role.name,
      target,
      postings: rows.length,
      thisWeek,
      lastWeek,
      trend,
      reachable,
      payMedian,
      asked,
      qualified,
      projects: [...byProject.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([p]) => p),
      applied: sent.length,
      responses,
      thin,
      score: thin ? 0 : Math.round(Math.min(100, 100 * (0.6 * qualified + 0.25 * demand + 0.15 * worth) * results)),
    };
  };
  return [...targets.map((r) => one(r, true)), ...candidates.map((r) => one(r, false)).sort((a, b) => b.score - a.score || a.role.localeCompare(b.role))];
}

/** One role's outlook as a sentence: what a reader, or a model judging the order, is given. */
export function outlookFact(o: RoleOutlook): string {
  if (o.thin) return `${o.role}: ${o.postings} postings in the last ${WINDOW_DAYS} days, too few to judge.`;
  const shown = o.asked.filter((a) => a.shown).slice(0, 4).map((a) => a.skill);
  const missing = o.asked.filter((a) => !a.shown).slice(0, 3).map((a) => a.skill);
  return (
    [
      `${o.role}${o.target ? "" : " (not on your list)"}: score ${o.score}`,
      `you can show ${pct(o.qualified)} of what its ${o.postings} postings ask for`,
      shown.length ? `shown: ${shown.join(", ")}` : "",
      missing.length ? `not shown: ${missing.join(", ")}` : "",
      o.projects.length ? `projects that back it: ${o.projects.join(", ")}` : "",
      `${o.thisWeek} new this week${o.trend === "flat" ? "" : ` (${o.trend} from ${o.lastWeek})`}`,
      `${pct(o.reachable)} remote or Salt Lake`,
      o.payMedian !== null ? `median posted pay ${money(o.payMedian)}` : "",
      o.applied ? `you applied to ${o.applied} and ${o.responses} answered` : "",
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
}

/**
 * The outlook as it is stored with the market report: your roles, plus the few candidate
 * roles with enough postings to judge, so the report stays small.
 */
export function outlookToStore(outlook: readonly RoleOutlook[]): RoleOutlook[] {
  return [...outlook.filter((o) => o.target), ...outlook.filter((o) => !o.target && !o.thin).slice(0, 5)].map((o) => ({ ...o, asked: o.asked.slice(0, 6).map((a) => ({ ...a, projects: a.projects.slice(0, 2) })) }));
}

/** The same outlook with the names of private projects left out: what a model is shown. */
export function withoutPrivate(outlook: readonly RoleOutlook[], privateProjects: ReadonlySet<string>): RoleOutlook[] {
  const mask = (names: string[]) => [...new Set(names.map((n) => (privateProjects.has(n) ? "a private project" : n)))];
  return outlook.map((o) => ({ ...o, projects: mask(o.projects), asked: o.asked.map((a) => ({ ...a, projects: mask(a.projects) })) }));
}

// ---------------------------------------------------------------------------
// The proposal

/** A lower role moves above the one over it only when it leads by this many points: small differences are noise. */
export const ORDER_MARGIN = 6;
/** A role changes place only with this many postings behind its numbers. Nobody should retarget on three listings. */
export const ORDER_MIN_POSTINGS = 5;
export const FOCUS = 3;
/** A candidate role must be this well shown, with this many postings, before it is suggested. */
const CANDIDATE_QUALIFIED = 0.6;
const CANDIDATE_POSTINGS = 5;

export interface RoleReason {
  role: string;
  why: string;
}

export interface RoleProposalDraft {
  /** Your order when the proposal was made. Approval is refused if your order has moved since. */
  base: string[];
  /** The proposed order, including any role added. */
  order: string[];
  /** Roles in `order` that are not on your list today (at most one). */
  added: string[];
  /** The first three of the proposed order: what to target now. */
  focus: string[];
  headline: string;
  reasons: RoleReason[];
  /** The outlook sentences the proposal rests on. */
  facts: string[];
  /** Candidate roles the model may choose to add (it may add none). */
  mayAdd: string[];
}

function settle(order: string[], score: (role: string) => number | null): string[] {
  // Only roles with enough data move, and only among the places those roles already hold.
  const slots = order.map((r, i) => (score(r) === null ? -1 : i)).filter((i) => i >= 0);
  const movable = slots.map((i) => order[i]!);
  for (let pass = 0; pass < movable.length; pass++) {
    let swapped = false;
    for (let i = 0; i + 1 < movable.length; i++) {
      if (score(movable[i + 1]!)! - score(movable[i]!)! >= ORDER_MARGIN) {
        [movable[i], movable[i + 1]] = [movable[i + 1]!, movable[i]!];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  const out = [...order];
  slots.forEach((slot, n) => (out[slot] = movable[n]!));
  return out;
}

/**
 * The rules' proposal: your order with a role moved up only where it clearly leads, and
 * the best candidate role added when it would sit in your top three. Returns null when
 * there is too little to go on.
 */
export function draftProposal(outlook: readonly RoleOutlook[]): RoleProposalDraft | null {
  const by = new Map(outlook.map((o) => [o.role, o]));
  const base = outlook.filter((o) => o.target).map((o) => o.role);
  const solid = (o: RoleOutlook) => !o.thin && o.postings >= ORDER_MIN_POSTINGS;
  if (base.length < 2 || outlook.filter((o) => o.target && solid(o)).length < 2) return null;
  const score = (role: string) => (solid(by.get(role)!) ? by.get(role)!.score : null);
  let order = settle(base, score);

  const third = [...order].map((r) => by.get(r)!).filter(solid).map((o) => o.score).sort((a, b) => b - a)[FOCUS - 1] ?? 0;
  const eligible = outlook.filter((o) => !o.target && solid(o) && o.postings >= CANDIDATE_POSTINGS && o.qualified >= CANDIDATE_QUALIFIED && o.score >= third + ORDER_MARGIN);
  const added: string[] = [];
  if (eligible[0]) {
    const c = eligible[0];
    // Placed just above the first role it clearly beats; otherwise it is not added.
    const at = order.findIndex((r) => solid(by.get(r)!) && c.score - by.get(r)!.score >= ORDER_MARGIN);
    if (at >= 0 && at < FOCUS) {
      order = [...order.slice(0, at), c.role, ...order.slice(at)];
      added.push(c.role);
    }
  }
  // You target at most five roles: a role added to a full list takes the last place's spot.
  const dropped = order.slice(MAX_ROLES);
  order = order.slice(0, MAX_ROLES);
  const focus = order.slice(0, FOCUS);
  const moved = order.filter((r) => base.includes(r) && order.filter((x) => base.includes(x)).indexOf(r) < base.indexOf(r));
  const reasons: RoleReason[] = [...new Set([...added, ...moved, ...focus])].slice(0, 6).map((role) => {
    const o = by.get(role)!;
    if (!solid(o)) return { role, why: o.postings === 0 ? "Kept where you placed it: no postings for it yet." : `Kept where you placed it: only ${o.postings} posting${o.postings === 1 ? "" : "s"}, too few to move a role on.` };
    const proof = o.projects.length ? `, backed by ${list(o.projects)}` : "";
    const verb = added.includes(role) ? "Not on your list, but you" : moved.includes(role) ? "Moved up: you" : "You";
    return { role, why: `${verb} can show ${pct(o.qualified)} of what its ${o.postings} postings ask for${proof}.${o.payMedian !== null ? ` Median posted pay ${money(o.payMedian)}.` : ""}` };
  });
  const lead = by.get(order[0]!)!;
  return {
    base,
    order,
    added,
    focus,
    headline: order[0] !== base[0] ? `Lead with ${order[0]}: it is the role you can show the most for (${pct(lead.qualified)})` : added.length ? `Consider adding ${added[0]}${dropped.length ? ` in place of ${list(dropped)}` : ""}: it would sit in your top three` : `Re-order your roles: ${list(moved.slice(0, 2))} moved up on what you can show`,
    reasons,
    facts: outlook.filter((o) => o.target || eligible.includes(o)).map(outlookFact),
    mayAdd: eligible.slice(0, 2).map((o) => o.role),
  };
}

export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/**
 * A model's judgment, checked. It may choose the order and add at most one of the roles it
 * was offered; every role on your list must appear exactly once; a role it moves or adds
 * needs a reason; and any number it writes must be in the facts it was given. Anything
 * else and its answer is dropped: the rules' proposal stands.
 */
export function acceptJudgment(draft: RoleProposalDraft, judged: { order: string[]; headline: string; reasons: RoleReason[] }): RoleProposalDraft | null {
  const order = judged.order.map((r) => r.trim());
  let added = order.filter((r) => !draft.base.includes(r));
  if (new Set(order).size !== order.length) return null;
  if (!draft.base.every((r) => order.includes(r))) return null;
  if (added.length > 1 || !added.every((r) => draft.mayAdd.includes(r))) return null;
  // At most five roles: an add on a full list drops whichever role the model put last.
  order.splice(MAX_ROLES);
  added = added.filter((r) => order.includes(r));
  const kept = order.filter((r) => draft.base.includes(r));
  const moved = kept.filter((r, i) => i < draft.base.indexOf(r));
  const reasons = judged.reasons.filter((x) => order.includes(x.role) && x.why.trim().length >= 10).map((x) => ({ role: x.role, why: x.why.replace(/\s+/g, " ").trim().slice(0, 320) }));
  if (![...moved, ...added].every((r) => reasons.some((x) => x.role === r))) return null;
  if (!numbersGrounded([judged.headline, ...reasons.map((x) => x.why)], draft.facts)) return null;
  return { ...draft, order, added, focus: order.slice(0, FOCUS), headline: judged.headline.replace(/\s+/g, " ").trim().slice(0, 160), reasons: reasons.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Stored proposals, and whether to raise one.

export interface RoleProposal {
  id: string;
  forDate: LocalDate;
  base: string[];
  proposed: string[];
  added: string[];
  focus: string[];
  headline: string;
  reasons: RoleReason[];
  facts: string[];
  writer: "model" | "rules";
  /**
   * new: waiting on you. approved: written to Notion. dismissed: you said no. stale: your
   * order changed before you decided. declined: the Career Mentor's own judgment was to leave your
   * order alone, kept so the same question is not asked again every morning.
   */
  status: "new" | "approved" | "dismissed" | "stale" | "declined";
  decidedAt: string | null;
  createdAt: string;
}

export type NewRoleProposal = Omit<RoleProposal, "id" | "createdAt" | "status" | "decidedAt"> & { status?: "new" | "declined" };

/** After you approve an order it is left alone for a week; one you turned down is not raised again for three. */
export const APPROVED_REST_DAYS = 7;
export const DISMISSED_REST_DAYS = 21;
/** When the Career Mentor itself judged "no change", it does not reconsider the same order for a week. */
export const DECLINED_REST_DAYS = 7;

/**
 * Whether a proposal is worth your attention now: it changes something, nothing is
 * already waiting, you did not just settle the order, and you have not recently turned
 * down this same order.
 */
export function worthProposing(draft: Pick<RoleProposalDraft, "base" | "order">, prior: readonly Pick<RoleProposal, "status" | "proposed" | "forDate">[], today: LocalDate): boolean {
  if (sameOrder(draft.base, draft.order)) return false;
  if (prior.some((p) => p.status === "new")) return false;
  if (prior.some((p) => p.status === "approved" && daysBetween(p.forDate, today) < APPROVED_REST_DAYS)) return false;
  if (prior.some((p) => p.status === "dismissed" && sameOrder(p.proposed, draft.order) && daysBetween(p.forDate, today) < DISMISSED_REST_DAYS)) return false;
  if (prior.some((p) => p.status === "declined" && sameOrder(p.proposed, draft.order) && daysBetween(p.forDate, today) < DECLINED_REST_DAYS)) return false;
  return true;
}
