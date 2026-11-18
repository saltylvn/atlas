# Finance Agent (build step 6, live)

Email only: no bank connection, no logins, no money moves (Copilot remains the budget
app). Rules only, no model call, so every run costs $0.

## What it reads

- The inbox the Email Agent already synced. It never reads Gmail itself; the Chief of
  Staff runs the Email Agent first, then the Finance Agent.
- Emails the Email Agent tagged **finance** (banks, cards, insurers, lenders, bills),
  **subscription** (the subscriptions in Settings) and **store** (the stores in Settings).
  Sender and subject only, plus Gmail's snippet when there is one. Mail older than
  45 days is ignored.
- Tyler's Renewals list.

## What it finds

- **Payment alerts**: failed, declined or past-due payments, late fees, overdrafts.
  Always first, in red.
- **Bills**, one per sender (or tracked subscription), from its latest bill email:
  due notices, statements ready, autopay coming up, subscriptions renewing, and
  payments that went through. The amount ("$142.18") and date ("due Nov 20",
  "renews on December 1", "scheduled for 11/28", "due tomorrow") are read from the
  latest email that names them.
- **Renewals due soon**: anything on the Renewals list inside its warning window.
- **Deals** from the stores Tyler keeps: the best sale or coupon per store. Holiday
  sales (Black Friday, Cyber Monday, Prime Day...) and 30%+ off are flagged as big
  sales. Order, shipping and receipt emails are never deals.

## What needs Tyler

A bill from a sender that is not on the Renewals list comes with **Track in Renewals**
on the Renewals page, with the name, date and repeat filled in. Nothing is added
without that click. Paid bills never ask.

## Where it shows

- The **Money** card in each weekday brief (Saturday's light brief has none).
- **From your email** and **Deals** on the Renewals page.
- Mission Control: Run Now, Pause, and every run in the activity log.

Code: `lib/domain/financeAgent.ts` (rules), `lib/agents/finance.ts` (run).

Later option: review a monthly transaction export from Copilot.
