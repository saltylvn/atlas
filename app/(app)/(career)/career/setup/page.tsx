import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { AnswerBankForm } from "@/components/client/CareerActions";
import { EligibilityAnswers, ProfileAnswers } from "@/components/client/FixedAnswers";
import { Icon, type IconName } from "@/components/Icon";
import { CardHeader, PageHeader } from "@/components/ui";
import { autofillData, embedJson } from "@/lib/domain/autofill";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { profileOf } from "@/lib/domain/formProfile";

export const metadata = { title: "Setup" };

/**
 * Setup: what you set once and Atlas Autofill uses on every application you make on your
 * MacBook. Your fixed answers, the answer bank and the Safari extension are here (the last two moved from Applications
 * when it became the Pipeline: docs/design-pipeline.md, 7); resumes and roles, and the watched
 * boards, are one tap away, each with where it stands.
 */
export default async function CareerSetupPage() {
  const ctx = await getContext();
  const { store, settings } = ctx;
  const watches = await store.watches.list().catch(() => []);
  const answered = ANSWER_BANK.filter((q) => (settings.careerAnswers?.[q.id] ?? "").trim()).length;
  const roles = careerPrefs(settings).roles.length;
  const links: { href: string; icon: IconName; title: string; what: string; now: string }[] = [
    { href: "#answers", icon: "copy", title: "Answer bank", what: "Your name, contact details, links and the answers Atlas fills into every form.", now: `${answered} of ${ANSWER_BANK.length} written` },
    { href: "/roles", icon: "team", title: "Target roles and resumes", what: "The roles you are going for, in order, and the resume each one uses. Applications send the PDF in that role's row in Notion.", now: `${roles} role${roles === 1 ? "" : "s"}` },
    { href: "/jobs#sources", icon: "hash", title: "Watched company boards", what: "Good fits come from these, beside the public job feeds.", now: `${watches.length} board${watches.length === 1 ? "" : "s"} watched` },
    { href: "#autofill", icon: "wand", title: "Safari extension", what: "Atlas Autofill fills application forms on your Mac from the answers here.", now: "Set up on your Mac" },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Setup" sub="Set once, used on every application you make on your MacBook." />
      <section id="fixed-answers" className="card card-pad scroll-mt-20 space-y-4">
        <CardHeader title="Your fixed answers" icon="shield" hint="The answers most forms ask for. Atlas Autofill uses them exactly as saved, and never guesses one." />
        <EligibilityAnswers saved={{ authorized: "", sponsorship: "", workedHere: "", gender: "", ...settings.careerEligibility }} />
        <ProfileAnswers saved={profileOf(settings.careerProfile)} />
      </section>
      <ul className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="card card-pad flex h-full items-start gap-3 hover:bg-surface-2">
              <Icon name={l.icon} size={20} className="mt-0.5 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="h-display block font-medium">{l.title}</span>
                <span className="mt-0.5 block text-sm text-ink-2">{l.what}</span>
                <span className="mt-2 block text-xs font-medium text-ink-3">{l.now}</span>
              </span>
              <Icon name="arrow" size={15} className="mt-1 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>

      <section id="answers" className="card card-pad scroll-mt-20">
        <CardHeader title="Answer bank" icon="copy" hint="Write each answer once. Every apply kit in your Apply Queue fills in {company} and {role} for that job, ready to paste into the application form." />
        <AnswerBankForm saved={settings.careerAnswers ?? {}} />
      </section>

      <section id="autofill" className="card card-pad scroll-mt-20">
        <CardHeader title="Atlas Autofill for Safari" icon="wand" hint="A Safari extension that fills application forms from your answer bank when you press Fill. You review and submit; it never submits, attaches files or answers work authorization or demographic questions." />
        {/* The extension reads this on your own Setup page and keeps a copy in Safari. Plain data, never run. */}
        <script type="application/json" id="atlas-autofill-data" dangerouslySetInnerHTML={{ __html: embedJson(autofillData(settings.careerAnswers)) }} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>Fill in the answer bank above, including your contact details, and save.</li>
          <li>Install the extension once on your Mac (it needs Xcode, which is free): the steps are in extension/safari/README.md in the Atlas repository.</li>
          <li>Open this page in Safari. The extension copies your answers from here; open it again after you change one.</li>
          <li>Open Career, then Apply, in Safari. The extension copies your Apply Queue from there.</li>
          <li>Click the A in Safari&apos;s toolbar and pick a job from your queue. On its application form, click the A again and press Fill this page.</li>
          <li>After you submit on the site, press Mark submitted in the extension. Atlas opens and asks you to confirm.</li>
        </ol>
        <p id="atlas-autofill-status" className="mt-3 text-sm text-ink-3">
          Not synced in this browser yet. With the extension installed, this line changes when it copies your answers.
        </p>
      </section>
    </div>
  );
}
