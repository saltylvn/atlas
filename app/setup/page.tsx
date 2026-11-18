export const metadata = { title: "Setup needed" };

// Shown when a production deploy has no database and no explicit demo flag.
// Fail closed: no data, no sign-in, just instructions.
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="h-display text-2xl font-semibold">Atlas isn&apos;t configured yet</h1>
      <p className="mt-3 text-ink-2">
        This deployment has no database settings, so it refuses to serve anything. Set the Supabase and owner variables listed in <code>.env.example</code>, then
        redeploy. See <code>docs/DEPLOY.md</code>.
      </p>
    </main>
  );
}
