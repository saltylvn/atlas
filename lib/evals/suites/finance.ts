import { billStatus, dealFrom, parseAmount, parseDueDate } from "@/lib/domain/financeAgent";
import type { EvalCase, EvalSuite } from "../types";

// Every bill below "arrives" on Monday 16 November 2026.
const RECEIVED = "2026-11-16";

/** [email subject, expected: kind | amount | date ("-" when the email names none)] */
const BILLS: [string, string][] = [
  ["Your payment of $142.18 is due Nov 20", "due | 142.18 | 2026-11-20"],
  ["Reminder: your payment is due tomorrow", "due | - | 2026-11-17"],
  ["Your premium is due Jan 5", "due | - | 2027-01-05"],
  ["Minimum payment due: $35.00 by 12/05", "due | 35 | 2026-12-05"],
  ["Payment failed: action required", "alert | - | -"],
  ["Your card was declined", "alert | - | -"],
  ["Your payment is past due", "alert | - | -"],
  ["Late fee assessed on your account", "alert | - | -"],
  ["Insufficient funds: payment returned", "alert | - | -"],
  ["Overdraft notice for your checking account", "alert | - | -"],
  ["Your AutoPay payment of $389.00 is scheduled for 11/28", "autopay | 389 | 2026-11-28"],
  ["Scheduled payment reminder", "autopay | - | -"],
  ["We received your payment of $50.00", "paid | 50 | -"],
  ["Thanks for your payment", "paid | - | -"],
  ["Payment confirmation: $75.50", "paid | 75.5 | -"],
  ["Your November statement is ready", "statement | - | -"],
  ["Your bill is ready to view", "statement | - | -"],
  ["eStatement available for account ending 4411", "statement | - | -"],
  ["Your invoice from Vercel Inc.", "statement | - | -"],
  ["Your statement balance is $1,204.33", "statement | 1204.33 | -"],
  ["Your membership renews on December 1", "renewal | - | 2026-12-01"],
  ["Your subscription fee will be charged on Nov 30", "renewal | - | 2026-11-30"],
  ["Your free trial ends in 3 days", "renewal | - | 2026-11-19"],
  ["Price increase for your HBO Max plan", "renewal | - | -"],
  // Not bills
  ["Updates to our Terms of Service and Privacy Policy", "not a bill"],
  ["Welcome to Chase Mobile", "not a bill"],
  ["Your order has shipped", "not a bill"],
  ["New sign-in to your account", "not a bill"],
];

function bill(subject: string): string {
  const status = billStatus(subject);
  if (!status) return "not a bill";
  return `${status} | ${parseAmount(subject) ?? "-"} | ${parseDueDate(subject, RECEIVED) ?? "-"}`;
}

/** [store email subject, expected] */
const DEALS: [string, string][] = [
  ["Black Friday deals start now: up to 40% off", "holiday sale, 40% off"],
  ["Cyber Monday: 50% off sitewide", "holiday sale, 50% off"],
  ["Members save 35% on TVs this week", "big sale, 35% off"],
  ["This week's savings: 15% off produce", "sale, 15% off"],
  ["Coupon inside: $10 off your next visit", "sale"],
  ["Save $20 on your next order", "sale"],
  ["Clearance event ends Sunday", "sale"],
  ["Your order has shipped", "not a deal"],
  ["Your receipt: 20% off applied", "not a deal"],
  ["New arrivals for fall", "not a deal"],
  ["The Fearless Flyer is here", "not a deal"],
];

function deal(subject: string): string {
  const d = dealFrom(subject);
  if (!d) return "not a deal";
  const kind = d.holiday ? "holiday sale" : d.major ? "big sale" : "sale";
  return d.percentOff ? `${kind}, ${d.percentOff}% off` : kind;
}

const cases: EvalCase[] = [
  ...BILLS.map(([subject, expected]): EvalCase => ({ name: `Bill · ${subject}`, expected, actual: () => bill(subject) })),
  ...DEALS.map(([subject, expected]): EvalCase => ({ name: `Deal · ${subject}`, expected, actual: () => deal(subject) })),
];

export const financeSuite: EvalSuite = {
  agent: "finance",
  title: "Reading bills and deals",
  what: "Reads what a bill email is (due, alert, autopay, paid, statement, renewal), its amount and date, and spots real sales from stores.",
  threshold: 0.95,
  cases,
};
