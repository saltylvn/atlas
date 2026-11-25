import { redirect } from "next/navigation";
import { connection } from "next/server";
import { mode } from "@/lib/env";
import { signInWithGoogle } from "@/app/actions/auth";
import { AppMark } from "@/components/AppMark";
import { hue } from "@/components/ui";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  not_owner: "That account isn't allowed here. Atlas has exactly one owner.",
  oauth: "Sign-in didn't complete. Try again.",
  rate_limited: "Too many attempts. Wait a few minutes.",
  callback: "Sign-in link expired or was already used.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  if (mode() !== "live") redirect("/");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7 text-center">
        <span className="mx-auto mb-4 block w-fit overflow-hidden rounded-2xl">
          <AppMark size={56} />
        </span>
        <h1 className="h-display text-2xl font-semibold">Atlas</h1>
        <p className="mt-1 text-sm text-ink-2">Your personal chief of staff.</p>
        {error && <p className="pill mt-4 !flex !min-h-0 !whitespace-normal rounded-lg px-3 py-2 text-sm" style={hue("var(--c-red)")}>{ERRORS[error] ?? "Something went wrong."}</p>}
        <form action={signInWithGoogle} className="mt-6">
          <button className="btn btn-primary w-full">Continue with Google</button>
        </form>
        <p className="mt-4 text-xs text-ink-3">Owner only. A one-time code from your authenticator app is required after sign-in.</p>
        <p className="mt-3 text-xs">
          <a href="/privacy" className="text-ink-3 underline">
            Privacy policy
          </a>
          <span className="text-ink-3"> · </span>
          <a href="/terms" className="text-ink-3 underline">
            Terms
          </a>
        </p>
      </div>
    </main>
  );
}
