import { aheadUntil, currentSlot, hourLabel, isSyncTime, nextBrief, nextSync, scheduledSlot, SLOT_LABEL } from "@/lib/domain/briefSchedule";
import { hotList } from "@/lib/domain/chiefOfStaff";
import type { CareerSnapshot, TrackedApplication, TrackedInterview } from "@/lib/domain/types";
import type { EvalCase, EvalSuite } from "../types";

// The week of Monday 16 November 2026. Saturday is the 21st, Sunday the 22nd.
const MON = "2026-11-16";
const FRI = "2026-11-20";
const SAT = "2026-11-21";
const SUN = "2026-11-22";
const DAY: Record<string, string> = { [MON]: "Monday", [FRI]: "Friday", [SAT]: "Saturday", [SUN]: "Sunday", "2026-11-23": "Monday" };

/** [day, which scheduled run fired, the brief it should write] */
const SCHEDULED: [string, "morning" | "afternoon", string][] = [
  [MON, "morning", "Morning Brief"],
  [MON, "afternoon", "2:00 PM Brief"],
  [FRI, "afternoon", "2:00 PM Brief"],
  [SAT, "morning", "Saturday Brief"],
  [SAT, "afternoon", "no brief"],
  [SUN, "morning", "no brief"],
  [SUN, "afternoon", "no brief"],
];

/** [day, time you pressed Run Now, the brief it should refresh] */
const RUN_NOW: [string, string, string][] = [
  [MON, "08:00", "Morning Brief"],
  [MON, "11:59", "Morning Brief"],
  [MON, "12:00", "2:00 PM Brief"],
  [FRI, "17:30", "2:00 PM Brief"],
  [SAT, "15:00", "Saturday Brief"],
];

/** [day, time now, the next scheduled brief] */
const NEXT: [string, string, string][] = [
  [MON, "08:00", "Monday Morning Brief"],
  [MON, "10:00", "Monday 2:00 PM Brief"],
  [FRI, "15:00", "Saturday Saturday Brief"],
  [SAT, "10:00", "Monday Morning Brief"],
  [SUN, "10:00", "Monday Morning Brief"],
];

/** [day, local time the scheduler called, should the 2-hour sync run?] */
const SYNC: [string, string, boolean][] = [
  [MON, "06:05", true],
  [MON, "06:58", true],
  [MON, "07:05", false],
  [MON, "16:05", true],
  [MON, "17:05", false],
  [MON, "05:05", false],
  [SAT, "12:05", true],
  [SUN, "10:05", false],
];

/** [day, time now, the next sync] */
const NEXT_SYNC: [string, string, string][] = [
  [MON, "05:30", "Monday 6 AM"],
  [MON, "06:30", "Monday 8 AM"],
  [MON, "16:30", "2026-11-17 6 AM"],
  [SAT, "16:30", "Monday 6 AM"],
  [SUN, "09:00", "Monday 6 AM"],
];

// The Hot List: offers, then interviews, then replies; stale ones drop off.
const NOW = new Date("2026-11-16T16:00:00Z");
const app = (company: string, stage: string, daysAgo: number, id = company): TrackedApplication => ({
  applicationId: id,
  company,
  role: "Solutions Engineer",
  stage,
  appliedDate: "2026-11-01",
  stageUpdatedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  nextAction: "",
  nextActionDue: "",
  postingUrl: "",
});
const interview = (applicationId: string, start: string, status = "Confirmed"): TrackedInterview => ({ interviewId: `i-${applicationId}`, applicationId, company: applicationId, role: "", round: "Interview 1", start, end: start, status, meetingLink: "" });
const snap = (applications: TrackedApplication[], interviews: TrackedInterview[] = []): CareerSnapshot => ({ generatedAt: NOW.toISOString(), applications, interviews });

/** [what is in the tracker, the tracker, the Hot List in order] */
const HOT: [string, CareerSnapshot, string][] = [
  ["A reply, an interview and an offer", snap([app("ReplyCo", "Reply", 1), app("InterviewCo", "Interview 1", 2), app("OfferCo", "Offer", 3)]), "OfferCo, InterviewCo, ReplyCo"],
  ["Only applications with no answer", snap([app("QuietCo", "Applied", 1), app("DraftCo", "Draft", 1)]), "(empty)"],
  ["A rejection and a reply", snap([app("NoCo", "Rejected", 1), app("ReplyCo", "Reply", 1)]), "ReplyCo"],
  ["A reply from three weeks ago", snap([app("OldCo", "Reply", 21)]), "(empty)"],
  ["An old interview stage with an interview still ahead", snap([app("AheadCo", "Interview 2", 30)], [interview("AheadCo", "2026-11-18T17:00:00Z")]), "AheadCo"],
  ["An old interview stage whose interview was cancelled", snap([app("GoneCo", "Interview 1", 30)], [interview("GoneCo", "2026-11-18T17:00:00Z", "Cancelled")]), "(empty)"],
  ["No tracker at all", null as unknown as CareerSnapshot, "(empty)"],
];

const label = (slot: ReturnType<typeof currentSlot> | null) => (slot ? SLOT_LABEL[slot] : "no brief");

const cases: EvalCase[] = [
  ...SCHEDULED.map(([day, wanted, expected]): EvalCase => ({ name: `Schedule · ${DAY[day]} ${wanted} run`, expected, actual: () => label(scheduledSlot(day, wanted)) })),
  ...RUN_NOW.map(([day, time, expected]): EvalCase => ({ name: `Run Now · ${DAY[day]} at ${time}`, expected, actual: () => label(currentSlot(day, time)) })),
  ...NEXT.map(([day, time, expected]): EvalCase => ({
    name: `Next brief · ${DAY[day]} at ${time}`,
    expected,
    actual: () => {
      const n = nextBrief(day, time);
      return `${DAY[n.day] ?? n.day} ${SLOT_LABEL[n.slot]}`;
    },
  })),
  ...SYNC.map(([day, time, expected]): EvalCase => ({ name: `2-hour sync · ${DAY[day]} at ${time}`, expected: expected ? "sync" : "no sync", actual: () => (isSyncTime(day, time) ? "sync" : "no sync") })),
  ...NEXT_SYNC.map(([day, time, expected]): EvalCase => ({
    name: `Next sync · ${DAY[day]} at ${time}`,
    expected,
    actual: () => {
      const n = nextSync(day, time);
      return `${DAY[n.day] ?? n.day} ${hourLabel(n.hour)}`;
    },
  })),
  { name: "Calendar window · weekday brief covers the week ahead", expected: "2026-11-22", actual: () => aheadUntil(MON, "morning") },
  { name: "Calendar window · Saturday brief covers today and tomorrow", expected: SUN, actual: () => aheadUntil(SAT, "saturday") },
  ...HOT.map(([name, snapshot, expected]): EvalCase => ({
    name: `Hot List · ${name}`,
    expected,
    actual: () =>
      hotList(snapshot, NOW, "America/Denver")
        .map((h) => h.company)
        .join(", ") || "(empty)",
  })),
];

export const chiefOfStaffSuite: EvalSuite = {
  agent: "chief-of-staff",
  title: "Scheduling and priorities",
  what: "Writes the right brief at the right time (Weekend Mode included) and orders the Hot List: offers, interviews, then replies.",
  threshold: 1,
  cases,
};
