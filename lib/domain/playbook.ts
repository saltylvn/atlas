// Where your time goes back to you. "live" ideas are built into Atlas today;
// "next" ideas are the roadmap, ordered by minutes saved per week for the effort.

export interface Play {
  title: string;
  why: string;
  minutesPerWeek: number;
  where: string;
  status: "live" | "next";
}

export const PLAYBOOK: Play[] = [
  { title: "One brief instead of six apps", why: "Weather, calendar, tasks, people, job search and headlines in one read, so the morning starts with decisions, not tab-hopping.", minutesPerWeek: 140, where: "Today", status: "live" },
  { title: "News digest instead of scrolling", why: "An allowlist of sources condensed into a few bullets per topic. You stay informed and stop at the end.", minutesPerWeek: 105, where: "News", status: "live" },
  { title: "Capacity-aware week plan", why: "The planner refuses to overbook a day, so you stop carrying the same five tasks from day to day.", minutesPerWeek: 60, where: "Plan", status: "live" },
  { title: "Job scan on autopilot", why: "The Applications bot finds matches for your seven roles every weekday brief and logs applications from your email.", minutesPerWeek: 100, where: "Career", status: "live" },
  { title: "Job hunt \"Do next\" queue", why: "Follow-ups, thank-you notes, interview prep, close-outs and the best new roles, ranked with minutes for each. Drafts are one tap to copy.", minutesPerWeek: 60, where: "Career", status: "live" },
  { title: "Weekly review with three fixes", why: "Time saved, tasks done vs planned, overdue and keep-in-touch debt, and pipeline velocity, turned into three concrete changes.", minutesPerWeek: 25, where: "Your team", status: "live" },
  { title: "Draft, then send", why: "Claude writes the first draft in your tone; your own Mail or Messages app sends it after you read it.", minutesPerWeek: 45, where: "People", status: "live" },
  { title: "Keep-in-touch cadence", why: "Each person gets a rhythm. Atlas remembers who is due and whose birthday is close, so you don't have to.", minutesPerWeek: 20, where: "People", status: "live" },
  { title: "A Sunday reset", why: "A weekly review that clears the backlog and sets three goals.", minutesPerWeek: 30, where: "Plan", status: "live" },
  { title: "Recurring tasks reschedule themselves", why: "Finish a weekly or weekday task and its next occurrence appears on the right day.", minutesPerWeek: 10, where: "Plan", status: "live" },
  { title: "Inbox triage", why: "Read-only Gmail sorted into reply, FYI and noise by rules you can read. The brief names who is waiting on you; noise stays out of sight.", minutesPerWeek: 120, where: "Inbox", status: "live" },
  { title: "Morning push notification", why: "Around 6 AM the brief's first lines arrive on your iPhone's lock screen, before you open anything else.", minutesPerWeek: 15, where: "Connectors", status: "live" },
  { title: "Capture from anywhere", why: "“Hey Siri, add to Atlas”: a Shortcut posts the thought to your backlog or ideas list. Say it once, find it later.", minutesPerWeek: 20, where: "Connectors", status: "live" },
  { title: "Projects and ideas that resurface", why: "Side projects and ideas with a next step and a review date. Parked ideas come back to the brief instead of being forgotten.", minutesPerWeek: 20, where: "Projects", status: "live" },
  { title: "Reply drafts for the inbox", why: "Claude drafts a reply to anything in Needs a reply, in your tone; your mail app sends it after you read it.", minutesPerWeek: 60, where: "Roadmap", status: "next" },
  { title: "Google Calendar connection", why: "Read today's events through the same Google connection instead of a secret iCal link, including who is in each meeting.", minutesPerWeek: 15, where: "Roadmap", status: "next" },
  { title: "Auto time-block deep work", why: "Write focus blocks for deep-work tasks onto your calendar, with buffers around meetings.", minutesPerWeek: 30, where: "Roadmap", status: "next" },
  { title: "Meeting prep packs", why: "Before each meeting: who is in it, your notes on them, and the last email between you.", minutesPerWeek: 40, where: "Roadmap", status: "next" },
  { title: "Bills, renewals and documents", why: "Registration, passport, subscriptions and insurance renewal dates with a two-week heads-up.", minutesPerWeek: 20, where: "Renewals", status: "live" },
  { title: "Health from the wellness tracker", why: "Pull workouts, weigh-ins and streaks from your wellness app into the brief, so health shares the same plan.", minutesPerWeek: 15, where: "Roadmap", status: "next" },
  { title: "Evening shutdown push", why: "At 5:30 PM: what got done, what moves to tomorrow, and tomorrow's top three, in one notification.", minutesPerWeek: 20, where: "Roadmap", status: "next" },
  { title: "Meal plan and grocery list", why: "Plan the week's dinners on Sunday and get one grocery list. Fewer store runs, fewer decisions.", minutesPerWeek: 60, where: "Roadmap", status: "next" },
];
