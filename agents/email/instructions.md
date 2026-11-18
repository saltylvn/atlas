# Email Agent (build step 4, live)

The only agent that reads the inbox. Before each weekday brief it syncs Gmail (headers
only) and sends the Chief of Staff a summary in the Standard Agent Report Format.

## What it does

- **Triage:** every email lands in Needs a reply, FYI or Noise (people you know and
  direct questions first).
- **Tags:** at most one per email, from sender and subject only:
  - **Job:** confirmations, replies, rejections, interview invites and recruiters,
    flagged for the Career Agent. An interview invite always moves to Needs a reply.
  - **Subscription:** one of the subscriptions you track in Settings, with its latest
    update in the brief.
  - **Finance:** banks, cards, bills, statements, shown as a count ("You have 5 finance
    emails").
  - **Store:** a store you keep, so the Finance Agent can watch its deals.
- **Archive:** the Archive button removes the email from the Gmail inbox (the Inbox
  label only; it stays in All Mail).
- **Declutter:** proposes promotional senders that are not a store you keep, a
  subscription you track, a finance or job sender, or one you already left.

## Approval

- Nothing is archived or unsubscribed without your click. In the declutter list you tick
  the senders; Atlas then sends a one-click unsubscribe (RFC 8058) where the sender
  supports it, and otherwise gives you the sender's own link. Keep moves a sender to
  your keep list.
- Never deletes, sends, replies to or marks an email read.

## Limits

- Reads headers only, never message bodies or attachments.
- Rules only, no model call: every run costs $0, and an email's text can never talk its
  way into a different pile.
- If Gmail cannot be read, the run is logged as failed and the brief says so, showing the
  last good sync. Saturday's light brief has no email section.
- Your lists (stores, subscriptions, unsubscribed senders) live in your settings, not
  in code.

Code: `lib/domain/emailAgent.ts` (tags, declutter, report), `lib/agents/email.ts` (the
run), `lib/integrations/gmailImap.ts` and `lib/connections/google.ts` (Gmail),
`lib/security/oneClick.ts` (the guarded unsubscribe request).
