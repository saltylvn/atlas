import Link from "next/link";
import { AppMark } from "@/components/AppMark";

// Terms of service: public, so Google's consent screen can link to it. Atlas is a personal
// tool with one user, its owner; these terms say so. Static: no data, no sign-in.

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-ink-2">
      <div className="mb-6 flex items-center gap-3">
        <span className="overflow-hidden rounded-xl">
          <AppMark size={40} />
        </span>
        <div>
          <h1 className="h-display text-2xl font-medium text-ink">Atlas terms of service</h1>
          <p className="text-xs text-ink-3">Last updated 24 November 2026</p>
        </div>
      </div>

      <section className="space-y-3">
        <p>Atlas is a personal chief-of-staff app built and used by one person, its owner. It is not offered to the public, and nobody else can sign in.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access is limited to the owner&apos;s Google account, with a second sign-in step.</li>
          <li>Atlas reads Google data only as described in the <Link href="/privacy" className="underline">privacy policy</Link>, and only read-only.</li>
          <li>Atlas drafts and suggests; it does not send, submit or delete anything outside the app on the owner&apos;s behalf.</li>
          <li>It is provided as is, with no warranty, for the owner&apos;s own use.</li>
          <li>These terms may change; the date above shows the latest version.</li>
        </ul>
      </section>

      <p className="mt-8 text-xs">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
