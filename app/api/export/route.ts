import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { audit } from "@/lib/audit";

// NIST CSF "Recover": the owner can take a complete copy of their data at any time.
// Gated by proxy.ts and again by getContext (owner + MFA).
export async function GET() {
  const { store, settings, now } = await getContext();
  const [tasks, goals, contacts, messages, routines, renewals, watches, auditTrail, ledger, applications, approvals, projects, snippets, jobMatches, briefs, agentRuns, inbox, connections] = await Promise.all([
    store.tasks.list(),
    store.goals.list(),
    store.contacts.list(),
    store.messages.list(),
    store.routines.list(),
    store.renewals.list(),
    store.watches.list(),
    store.audit.recent(1000),
    store.ledger.since("1970-01-01T00:00:00Z"),
    store.applications.list(),
    store.approvals.list(),
    store.projects.list(),
    store.snippets.list(),
    store.jobMatches.since("2000-01-01"),
    store.briefs.search({ limit: 200 }),
    store.agentRuns.since("1970-01-01T00:00:00Z"),
    store.inbox.list(),
    // Account and status only: stored credentials are never readable from a session.
    store.connections.list(),
  ]);
  await audit(store, { actor: "owner", action: "data.export", target: "all", detail: "", outcome: "success" });
  const body = JSON.stringify(
    {
      exportedAt: now.toISOString(),
      version: 2,
      settings,
      tasks,
      goals,
      contacts,
      messages,
      routines,
      renewals,
      watches,
      projects,
      snippets,
      ledger,
      applications,
      approvals,
      jobMatches,
      briefs,
      inbox,
      connections,
      agentRuns,
      audit: auditTrail,
    },
    null,
    2,
  );
  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="atlas-export-${now.toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
