import { describe, expect, it } from "vitest";
import type { EmailPrefs } from "@/lib/domain/emailAgent";
import { billStatus, dealFrom, financeAgentReport, parseAmount, parseDueDate, trackSuggestion } from "@/lib/domain/financeAgent";
import type { InboxItem, Renewal } from "@/lib/domain/types";

const TODAY = "2026-11-16";
let seq = 0;
const mail = (fromName: string, fromEmail: string, subject: string, over: Partial<InboxItem> = {}): InboxItem => {
  seq++;
  return {
    id: `i${seq}`,
    messageId: `m${seq}`,
    threadId: `t${seq}`,
    fromName,
    fromEmail,
    subject,
    snippet: "",
    receivedAt: new Date(Date.UTC(2026, 10, 15, 12, seq)).toISOString(),
    category: "fyi",
    reason: "Addressed to you",
    done: false,
    createdAt: "2026-11-15T12:00:00Z",
    ...over,
  };
};
const promo = (fromName: string, fromEmail: string, subject: string) => mail(fromName, fromEmail, subject, { category: "noise", reason: "Mailing list or automated" });

const prefs: EmailPrefs = {
  stores: ["Trader Joe's", "Amazon", "Costco"],
  subscriptions: ["Harborview Insurance", "Lakeshore Financial (Car Payment)", "HBO Max", "Apex Fitness", "North Star loan payment"],
  unsubscribed: [],
};

const renewal = (title: string, over: Partial<Renewal> = {}): Renewal => ({
  id: `r-${title}`,
  title,
  kind: "bill",
  dueOn: "2026-11-20",
  leadDays: 7,
  cadence: "monthly",
  anchorDay: 20,
  url: "",
  notes: "",
  createdAt: "2026-11-01T12:00:00Z",
  ...over,
});

describe("Reading a bill email", () => {
  it("knows alerts, payments, autopay, renewals, due notices and statements apart", () => {
    expect(billStatus("Your payment is past due")).toBe("alert");
    expect(billStatus("Payment declined: update your payment method")).toBe("alert");
    expect(billStatus("We received your payment of $142.18")).toBe("paid");
    expect(billStatus("Your AutoPay is scheduled for Nov 20")).toBe("autopay");
    expect(billStatus("Your membership renews on December 1")).toBe("renewal");
    expect(billStatus("Reminder: your payment is due soon")).toBe("due");
    expect(billStatus("Your November statement is ready")).toBe("statement");
    expect(billStatus("Updates to our Terms of Service and Privacy Policy")).toBeNull();
    expect(billStatus("We've updated our privacy policy and renewal terms")).toBeNull();
  });

  it("reads amounts and due dates", () => {
    expect(parseAmount("Your bill of $1,234.56 is ready")).toBe(1234.56);
    expect(parseAmount("Pay $89 by Friday")).toBe(89);
    expect(parseAmount("Save $0 today")).toBeNull();
    expect(parseAmount("No amount here")).toBeNull();
    expect(parseDueDate("Payment due Nov 20", TODAY)).toBe("2026-11-20");
    expect(parseDueDate("Your plan renews on Monday, December 1st", TODAY)).toBe("2026-12-01");
    expect(parseDueDate("AutoPay scheduled for 11/28", TODAY)).toBe("2026-11-28");
    expect(parseDueDate("Payment due tomorrow", TODAY)).toBe("2026-11-17");
    expect(parseDueDate("Due in 3 days", TODAY)).toBe("2026-11-19");
    // A January date seen in November is next year's.
    expect(parseDueDate("Your premium is due Jan 5", TODAY)).toBe("2027-01-05");
    // A late notice for last month stays this year.
    expect(parseDueDate("Your payment due Oct 30 is past due", TODAY)).toBe("2026-10-30");
    expect(parseDueDate("Statement due 2/30", TODAY)).toBeNull();
    expect(parseDueDate("Nothing due here", TODAY)).toBeNull();
  });

  it("finds sales, not order updates, and flags holiday and big ones", () => {
    expect(dealFrom("Black Friday deals start now: up to 40% off")).toEqual({ percentOff: 40, holiday: true, major: true });
    expect(dealFrom("This week's savings: 15% off produce")).toEqual({ percentOff: 15, holiday: false, major: false });
    expect(dealFrom("Members save 35% on TVs")).toMatchObject({ major: true });
    expect(dealFrom("Your order has shipped")).toBeNull();
    expect(dealFrom("Your receipt: 20% off applied")).toBeNull();
    expect(dealFrom("Fearless Flyer: new arrivals")).toBeNull();
  });
});

describe("Finance bot report", () => {
  const items = [
    mail("Harborview", "billing@email.harborview.com", "Your payment of $142.18 is due Nov 20"),
    mail("Lakeshore Financial", "noreply@lakeshorefinancial.com", "Payment failed: action required"),
    mail("Lakeshore Financial", "noreply@lakeshorefinancial.com", "Your statement is ready", { receivedAt: "2026-11-10T12:00:00Z" }),
    mail("Chase", "no.reply.alerts@chase.com", "Your credit card statement is ready"),
    mail("NorthStar Financial", "info@northstarfinancial.com", "Thank you for your payment"),
    promo("Costco", "costco@online.costco.com", "Black Friday savings: up to 40% off"),
    promo("Costco", "costco@online.costco.com", "Weekly deals: 10% off"),
    promo("Amazon.com", "store-news@amazon.com", "Today's deals: 25% off kitchen"),
    promo("Amazon.com", "shipment-tracking@amazon.com", "Your order has shipped"),
    promo("RandomShop", "news@randomshop.com", "Huge sale: 70% off"),
    mail("Dropbox", "no-reply@notices.dropbox.com", "Updates to our Terms of Service and Privacy Policy"),
    // Old mail does not count.
    mail("Discover", "alerts@discover.com", "Payment past due", { receivedAt: "2026-08-01T12:00:00Z" }),
  ];
  const renewals = [renewal("Harborview car insurance", { dueOn: "2026-11-18" })];
  const r = financeAgentReport({ today: TODAY, items, prefs, renewals, inboxReady: true });

  it("puts payment alerts first and groups bills by sender", () => {
    expect(r.section.alerts.map((b) => b.name)).toEqual(["Lakeshore Financial (Car Payment)"]);
    const lakeshore = r.bills.find((b) => b.name.startsWith("Lakeshore"));
    expect(lakeshore?.status).toBe("alert");
    expect(r.bills.filter((b) => b.name.startsWith("Lakeshore"))).toHaveLength(1);
    expect(r.bills.find((b) => b.name === "Discover")).toBeUndefined();
    expect(r.bills.find((b) => b.key === "dropbox.com")).toBeUndefined();
  });

  it("reads amounts and dates, and matches your Renewals list", () => {
    const prog = r.bills.find((b) => b.name === "Harborview Insurance");
    expect(prog).toMatchObject({ status: "due", amount: 142.18, dueOn: "2026-11-20", subscription: true, trackedId: "r-Harborview car insurance" });
    expect(r.bills.find((b) => b.name === "Chase")).toMatchObject({ status: "statement", trackedId: null, subscription: false });
    expect(r.bills.find((b) => b.name === "North Star loan payment")?.status).toBe("paid");
  });

  it("asks before tracking untracked bills, never for paid ones", () => {
    expect(r.report.needsApproval).toEqual(expect.arrayContaining(["Track Lakeshore Financial (Car Payment) in Renewals", "Track Chase in Renewals"]));
    expect(r.report.needsApproval.join(" ")).not.toContain("Harborview");
    expect(r.report.needsApproval.join(" ")).not.toContain("North Star");
    expect(r.section.untracked).toBe(2);
    expect(trackSuggestion(r.bills.find((b) => b.name === "Chase")!)).toEqual({ title: "Chase", kind: "bill", dueOn: null, cadence: "monthly" });
    expect(trackSuggestion(r.bills.find((b) => b.name.startsWith("Lakeshore"))!).kind).toBe("renewal");
  });

  it("keeps the best deal per kept store, holiday sales first, and ignores other stores", () => {
    expect(r.deals.map((d) => d.store)).toEqual(["Costco", "Amazon"]);
    expect(r.deals[0]).toMatchObject({ holiday: true, percentOff: 40, major: true });
    expect(r.deals[1]).toMatchObject({ percentOff: 25, major: false });
  });

  it("includes Renewals due soon and writes a headline", () => {
    expect(r.section.dueSoon).toEqual([{ title: "Harborview car insurance", kind: "bill", when: "in 2 days" }]);
    expect(r.report.agent).toBe("finance");
    expect(r.report.headline).toBe("1 payment alert, 1 bill or renewal due soon, 2 bills in your email, 2 deals at stores you keep.");
    expect(r.report.errors).toEqual([]);
  });

  it("says so when the inbox has not been read, and still checks Renewals", () => {
    const empty = financeAgentReport({ today: TODAY, items, prefs, renewals, inboxReady: false });
    expect(empty.bills).toEqual([]);
    expect(empty.section.dueSoon).toHaveLength(1);
    expect(empty.report.errors[0]).toContain("Connect Gmail");
    expect(financeAgentReport({ today: TODAY, items: [], prefs, renewals: [], inboxReady: true }).report.headline).toBe("No bills due, no payment alerts, no deals today.");
  });
});
