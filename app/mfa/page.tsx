import { redirect } from "next/navigation";
import { afterSignIn } from "@/lib/mcp/consentReturn";
import { connection } from "next/server";
import { mode } from "@/lib/env";
import { createUserClient } from "@/lib/supabase/server";
import { signOutToLogin } from "@/app/actions/auth";
import { MfaPanel } from "@/components/client/MfaPanel";
import { AppMark } from "@/components/AppMark";

export const metadata = { title: "Verify" };

export default async function MfaPage() {
  await connection();
  if (mode() !== "live") redirect("/");
  const db = await createUserClient();
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect(await afterSignIn(false));
  const { data: factors } = await db.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7">
        <span className="mb-4 block w-fit overflow-hidden rounded-xl">
          <AppMark size={44} />
        </span>
        <h1 className="h-display text-xl font-semibold">{verified ? "Enter your code" : "Set up two-step sign-in"}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {verified ? "Open your authenticator app and enter the 6-digit code for Atlas." : "Atlas requires an authenticator app (1Password, Google Authenticator, Authy). Scan the code, then enter the 6 digits it shows."}
        </p>
        <MfaPanel factorId={verified?.id ?? null} />
        <form action={signOutToLogin} className="mt-4 text-center">
          <button className="text-xs text-ink-3 underline">Use a different account</button>
        </form>
      </div>
    </main>
  );
}
