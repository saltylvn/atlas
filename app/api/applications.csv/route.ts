import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { applicationsCsv } from "@/lib/domain/applications";

// The optional spreadsheet export of the application tracker. Gated by proxy.ts and
// again by getContext (owner + MFA). Cells that start like a formula are neutralized.
export async function GET() {
  const { store, now } = await getContext();
  const apps = await store.applications.list();
  await audit(store, { actor: "owner", action: "application.export", target: "csv", detail: `${apps.length} rows`, outcome: "success" });
  return new NextResponse(applicationsCsv(apps), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="atlas-applications-${now.toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
