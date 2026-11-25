import { tagEmail, type EmailPrefs } from "@/lib/domain/emailAgent";
import { triage, type MailMeta } from "@/lib/domain/inbox";
import type { InboxCategory, InboxItem } from "@/lib/domain/types";
import type { EvalCase, EvalSuite } from "../types";

// Example lists in the shape the owner keeps them in Settings.
const prefs: EmailPrefs = {
  stores: ["Trader Joe's", "Amazon", "Costco"],
  subscriptions: ["Shiny Bubble Car Wash", "Harborview Insurance", "Lakeshore Financial (Car Payment)", "HBO Max", "Disney/Hulu", "Amazon subscription", "North Star loan payment", "Apex Fitness"],
  unsubscribed: [],
};

const LIST = "Mailing list or automated";
const NOTIFY = "Notification sender";
const DIRECT = "Addressed to you";

/** [from name, from address, subject, pile, reason, expected tag] */
type TagRow = [string, string, string, InboxCategory, string, string];

const TAGS: TagRow[] = [
  // Job mail
  ["Acme Hiring", "no-reply@greenhouse-mail.io", "Thank you for applying to Acme", "noise", NOTIFY, "job:confirmation"],
  ["Tessel", "no-reply@ashbyhq.com", "Your application to Tessel", "noise", NOTIFY, "job:confirmation"],
  ["Northwind Recruiting", "no-reply@greenhouse-mail.io", "Voluntary self-identification survey", "noise", NOTIFY, "job:confirmation"],
  ["Workday", "talent@myworkday.com", "Action required: finish setting up your candidate account", "noise", NOTIFY, "job:confirmation"],
  ["Jane Kim", "jane.kim@northwind.io", "Solutions Engineer role at Northwind", "fyi", DIRECT, "job:recruiter"],
  // An interview by its subject: these emails are unread, so the subject is all there is. Once
  // the text is read it decides (lib/evals/suites/pipeline.ts has those cases).
  ["Sam Ortiz", "sam@halcyon.ai", "Interview availability for the Forward Deployed Engineer role", "fyi", DIRECT, "job:interview"],
  ["Dana Whitfield", "dana@northwindlabs.com", "Re: Solutions Engineer interview", "reply", "Asks you something directly", "job:interview"],
  ["Lever", "no-reply@hire.lever.co", "Update on your application", "noise", NOTIFY, "job:reply"],
  // "Next steps" names no interview: a reply, so its text is read and decides the rest.
  ["Halcyon Recruiting", "recruiting@halcyon.ai", "Next steps for your application", "fyi", "Update or receipt", "job:reply"],
  ["Northwind Recruiting", "no-reply@greenhouse-mail.io", "Next steps with Northwind", "noise", NOTIFY, "job:reply"],
  ["Tessel", "no-reply@ashbyhq.com", "Thank you for applying to Tessel: next steps", "noise", NOTIFY, "job:confirmation"],
  ["Brightcall Careers", "no-reply@greenhouse-mail.io", "Update: we are not moving forward with your application", "noise", NOTIFY, "job:rejection"],
  ["Priya Shah", "priya@stafflink.com", "Exciting opportunity: Senior Java Developer", "fyi", DIRECT, "job:recruiter"],
  // Not job mail, though it looks close
  ["Indeed", "alert@match.indeed.com", "Cloud Engineer @ The Harlow Group", "noise", LIST, "none"],
  ["Sprout & Stem", "news@sproutandstem.example", "Next steps for your spring garden", "noise", LIST, "none"],
  ["LinkedIn Job Alerts", "jobalerts-noreply@linkedin.com", "Sam, 12 new jobs for you", "noise", LIST, "none"],
  ["vercel[bot]", "notifications@github.com", "Re: [saltylvn/atlas-optim] Target roles page: similar job titles and a resume link per role (PR #34)", "noise", LIST, "none"],
  ["vercel[bot]", "notifications@github.com", "Re: [saltylvn/atlas-optim] Fix application parsing found on the first real Gmail catch-up (PR #33)", "noise", LIST, "none"],
  ["Perplexity", "team@mail.perplexity.ai", "Needs your response: Atlas Daily Briefing App", "fyi", "Update or receipt", "none"],
  // Subscriptions you track
  ["Harborview", "billing@email.harborview.com", "Your policy documents are ready", "fyi", "Update or receipt", "subscription:Harborview Insurance"],
  ["Lakeshore Financial", "noreply@lakeshorefinancial.com", "Your payment is due", "fyi", "Update or receipt", "subscription:Lakeshore Financial (Car Payment)"],
  ["HBO Max", "hbomax@mail.hbomax.com", "Your subscription renews soon", "noise", LIST, "subscription:HBO Max"],
  ["Hulu", "hulu@hulumail.com", "Your Hulu payment was received", "fyi", "Update or receipt", "subscription:Disney/Hulu"],
  ["Disney+", "disneyplus@mail.disneyplus.com", "Your Disney+ receipt", "fyi", "Update or receipt", "subscription:Disney/Hulu"],
  ["Amazon.com", "no-reply@amazon.com", "Your Prime membership renews on December 1", "noise", NOTIFY, "subscription:Amazon subscription"],
  ["NorthStar Financial", "info@northstarfinancial.com", "Your loan payment is scheduled", "fyi", "Update or receipt", "subscription:North Star loan payment"],
  ["APEX Fitness", "hello@apexfitness.com", "Your membership renews Dec 1", "noise", LIST, "subscription:Apex Fitness"],
  ["Shiny Bubble Car Wash", "info@washclubmail.com", "Your Unlimited membership receipt", "fyi", "Update or receipt", "subscription:Shiny Bubble Car Wash"],
  // Finance
  ["Chase", "no.reply.alerts@chase.com", "Your statement is ready", "noise", NOTIFY, "finance"],
  ["PayPal", "service@paypal.com", "Receipt for your payment to Spotify", "fyi", "Update or receipt", "finance"],
  ["Xcel Energy", "billing@xcelenergy.com", "Your bill is ready", "fyi", "Update or receipt", "finance"],
  // Stores you keep
  ["Amazon.com", "store-news@amazon.com", "Deals for you: 30% off kitchen", "noise", LIST, "store:Amazon"],
  ["Costco", "costco@online.costco.com", "Member-only savings this week", "noise", LIST, "store:Costco"],
  ["Trader Joe's", "news@traderjoes.com", "The Fearless Flyer is here", "noise", LIST, "store:Trader Joe's"],
  // Everything else gets no tag
  ["Dropbox", "no-reply@notices.dropbox.com", "Updates to our Terms of Service and Privacy Policy", "noise", NOTIFY, "none"],
  ["Facebook Marketplace", "notification@facebookmail.com", "Road bike - $100", "noise", LIST, "none"],
  ["Vercel", "notifications@vercel.com", "Production deployment failed for atlas-optim", "noise", NOTIFY, "none"],
  ["Linear", "notifications@updates.linear.app", "New login to Linear", "fyi", DIRECT, "none"],
  ["Google", "no-reply@accounts.google.com", "Security alert", "noise", NOTIFY, "none"],
];

const item = ([fromName, fromEmail, subject, category, reason]: TagRow): InboxItem => ({
  id: "e",
  messageId: "m",
  threadId: "t",
  fromName,
  fromEmail,
  subject,
  snippet: "",
  receivedAt: "2026-11-16T12:00:00Z",
  category,
  reason,
  done: false,
  createdAt: "2026-11-16T12:00:00Z",
});

function tagOf(row: TagRow): string {
  const t = tagEmail(item(row), prefs);
  if (t.tag === "job") return `job:${t.jobKind}`;
  if (t.tag === "subscription" || t.tag === "store") return `${t.tag}:${t.matched}`;
  return t.tag ?? "none";
}

// ---------------------------------------------------------------------------
// Which pile an email lands in: needs a reply, worth a glance, or noise.

const OWNER = "tyler@example.com";
const CONTACTS = [{ name: "Mom", email: "mom@example.com", circle: "family" as const }];

const meta = (over: Partial<MailMeta>): MailMeta => ({
  id: "1",
  threadId: "1",
  from: "Someone <someone@example.org>",
  to: OWNER,
  cc: "",
  subject: "",
  snippet: "",
  receivedAt: "2026-11-16T12:00:00Z",
  labelIds: [],
  listUnsubscribe: false,
  precedence: "",
  autoSubmitted: "",
  ...over,
});

/** [what it is, the email, expected pile] */
const PILES: [string, Partial<MailMeta>, InboxCategory][] = [
  ["From a contact (Mom)", { from: "Mom <mom@example.com>", subject: "Sunday dinner" }, "reply"],
  ["A person asks you a question", { from: "Jane Kim <jane@northwind.io>", subject: "Can you send your availability?" }, "reply"],
  ["A person writes, Gmail marks it important", { from: "Sam Ortiz <sam@halcyon.ai>", subject: "Next steps", labelIds: ["IMPORTANT"] }, "reply"],
  ["A login code Gmail marked important", { from: "Vercel <security@vercel.com>", subject: "Your Vercel security code: 000000", labelIds: ["IMPORTANT"] }, "fyi"],
  ["A verification code", { from: "Notion Team <team@mail.notion.so>", subject: "Your temporary Notion login code", labelIds: ["IMPORTANT"] }, "fyi"],
  ["A newsletter with an unsubscribe header", { from: "The Verge <hello@theverge.com>", subject: "Today's top stories", listUnsubscribe: true }, "noise"],
  ["A no-reply sender", { from: "GitHub <noreply@github.com>", subject: "[GitHub] A new SSH key was added" }, "noise"],
  ["Gmail promotions", { from: "Brand <deals@brand.com>", subject: "50% off today", labelIds: ["CATEGORY_PROMOTIONS"] }, "noise"],
  ["An auto-reply", { from: "Pat Lee <pat@corp.com>", subject: "Out of office", autoSubmitted: "auto-replied" }, "noise"],
  ["A receipt", { from: "Apple <receipts@apple.com>", subject: "Your receipt from Apple", labelIds: ["CATEGORY_UPDATES"] }, "fyi"],
  ["You were only copied", { from: "Lee Park <lee@corp.com>", to: "team@corp.com", cc: OWNER, subject: "Notes from today" }, "fyi"],
  ["A plain note to you, no question", { from: "Lee Park <lee@corp.com>", subject: "Notes from today" }, "fyi"],
];

const cases: EvalCase[] = [
  ...TAGS.map((row): EvalCase => ({ name: `Tag · ${row[0]}: ${row[2]}`, expected: row[5], actual: () => tagOf(row) })),
  ...PILES.map(([name, m, expected]): EvalCase => ({ name: `Pile · ${name}`, expected, actual: () => triage(meta(m), CONTACTS, OWNER).category })),
];

export const emailSuite: EvalSuite = {
  agent: "email",
  title: "Sorting and tagging email",
  what: "Puts each email in the right pile (reply, glance, noise) and tags job, subscription, finance and store mail from the sender and subject.",
  threshold: 0.95,
  cases,
};
