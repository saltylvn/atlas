import Link from "next/link";
import { AppMark } from "@/components/AppMark";

// The privacy policy: public, so Google's consent screen (and anyone else) can link to it.
// Atlas is a personal tool with one user, its owner; this page says plainly what it reads
// from Google and what it does with it. Static: no data, no sign-in.

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-ink-2">
      <div className="mb-6 flex items-center gap-3">
        <span className="overflow-hidden rounded-xl">
          <AppMark size={40} />
        </span>
        <div>
          <h1 className="h-display text-2xl font-medium text-ink">Atlas privacy policy</h1>
          <p className="text-xs text-ink-3">Last updated 24 November 2026</p>
        </div>
      </div>

      <section className="space-y-3">
        <p>
          Atlas is a personal chief-of-staff app with exactly one user: its owner. Nobody else can sign in. This page explains what Atlas reads, why, and how to
          stop it.
        </p>

        <h2 className="h-display pt-3 text-base font-medium text-ink">What Atlas reads from Google</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Sign-in:</b> your Google account email, to check that you are the owner.
          </li>
          <li>
            <b>Google Calendar (read-only), only if you connect it:</b> the list of calendars you show in Google Calendar, with their colors, and the events on
            them. Atlas uses them to draw your day and plan around your meetings. It never creates, edits or deletes an event.
          </li>
          <li>
            <b>Gmail (read-only), only if you connect it:</b> sender, subject and labels of recent inbox email, and the text of job-related email, to keep your
            inbox and job applications up to date. Nothing is sent from your account.
          </li>
        </ul>

        <h2 className="h-display pt-3 text-base font-medium text-ink">How it is kept</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Calendar events are read live and kept in server memory for a few minutes; they are not stored in a database.</li>
          <li>Google access tokens are encrypted (AES-256-GCM) and opened only to read on your behalf.</li>
          <li>Data Atlas does store sits in its own database, readable only by the owner&apos;s account.</li>
        </ul>

        <h2 className="h-display pt-3 text-base font-medium text-ink">What Atlas never does</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>It does not sell, share or transfer your Google data to anyone.</li>
          <li>It does not use your Google data for advertising.</li>
          <li>It does not use your Google data to train AI models.</li>
        </ul>
        <p>
          Atlas&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2 className="h-display pt-3 text-base font-medium text-ink">Stopping access</h2>
        <p>
          Disconnect Google Calendar or Gmail in Atlas under Connectors, which revokes Atlas&apos;s access at Google and deletes the stored token. You can also remove
          Atlas at{" "}
          <a className="underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </p>

        <h2 className="h-display pt-3 text-base font-medium text-ink">Contact</h2>
        <p>Questions go to the support email shown on Google&apos;s consent screen for Atlas.</p>
      </section>

      <p className="mt-8 text-xs">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
