import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { env, mode } from "@/lib/env";
import { ownerServiceStore, serviceReady } from "@/lib/owner";
import { bearerMatches } from "@/lib/security/bearer";
import { rateLimit } from "@/lib/security/rateLimit";

// Capture from anywhere: an iPhone Shortcut ("Hey Siri, tell Atlas...") posts here with
// a bearer token. A task lands in the backlog, or an idea on the Projects page.

const Body = z.object({
  text: z.string().trim().min(1).max(200),
  kind: z.enum(["task", "idea"]).default("task"),
});

export async function POST(request: NextRequest) {
  if (!bearerMatches(request.headers.get("authorization"), env().ATLAS_CAPTURE_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (mode() !== "live" || !serviceReady()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!rateLimit("capture", 30, 60 * 60_000).allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { text: raw };
  }
  const p = Body.safeParse(parsed);
  if (!p.success) return NextResponse.json({ error: "text is required (1-200 characters)" }, { status: 400 });

  const store = ownerServiceStore();
  if (p.data.kind === "idea") {
    await store.projects.create({ title: p.data.text.slice(0, 160), kind: "idea", status: "idea", why: "", nextStep: "", link: null, reviewOn: null });
  } else {
    await store.tasks.create({
      title: p.data.text,
      notes: "Captured from Shortcut",
      status: "todo",
      priority: "medium",
      area: "personal",
      day: null,
      startTime: null,
      estimateMin: 30,
      energy: "shallow",
      recurrence: "none",
      completedAt: null,
    });
  }
  await audit(store, { actor: "system", action: `capture.${p.data.kind}`, target: "shortcut", detail: "", outcome: "success" });
  return NextResponse.json({ ok: true, saved: p.data.kind }, { status: 201 });
}
