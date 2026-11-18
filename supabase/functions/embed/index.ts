import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Atlas: embeddings.
//
// Turns text into 384-number vectors with gte-small, which runs inside Supabase's edge
// runtime. The text never leaves this project and no outside AI service is called.
//
// Who may call it: only the Atlas server, presenting this project's secret key on the
// `apikey` header (lib/ai/embeddings.ts). Secret keys are not JWTs, so the platform's
// own JWT check is off for this function and the check below is the gate. It runs before
// the body is read. The function reads and writes no data: it only does arithmetic on
// the text it is handed.

const MAX_INPUTS = 8;
const MAX_CHARS = 2000;
const MAX_BODY_BYTES = 64_000;

const session = new Supabase.ai.Session("gte-small");
const encoder = new TextEncoder();

function acceptedKeys(): string[] {
  const keys: string[] = [];
  try {
    for (const v of Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))) if (typeof v === "string") keys.push(v);
  } catch {
    // Not set or not JSON: fall through to the legacy key.
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  return keys.filter((k) => k.length >= 20);
}

/** Compares two strings without leaking where they differ: both are hashed, then every byte is compared. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(a)), crypto.subtle.digest("SHA-256", encoder.encode(b))]);
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i]! ^ q[i]!;
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const presented = req.headers.get("apikey") ?? "";
  let allowed = false;
  if (presented.length >= 20) for (const key of acceptedKeys()) if (await same(presented, key)) allowed = true;
  if (!allowed) return json({ error: "unauthorized" }, 401);

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  let inputs: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
    inputs = (JSON.parse(text) as { inputs?: unknown }).inputs;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_INPUTS || !inputs.every((t) => typeof t === "string" && t.trim().length > 0 && t.length <= MAX_CHARS)) {
    return json({ error: "bad request" }, 400);
  }

  try {
    const embeddings: number[][] = [];
    for (const text of inputs as string[]) {
      // mean_pool + normalize: one unit-length vector per text, so cosine distance is meaningful.
      embeddings.push((await session.run(text, { mean_pool: true, normalize: true })) as number[]);
    }
    return json({ model: "gte-small", dims: 384, embeddings });
  } catch {
    // Never echo the input or the error text.
    console.error("[embed] inference failed");
    return json({ error: "embedding failed" }, 500);
  }
});
