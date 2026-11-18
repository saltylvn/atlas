import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { safeFetchText } from "@/lib/security/safeFetch";

// Embeddings for Ask Atlas: text in, a 384-number vector out, so passages can be found
// by meaning. The model (gte-small) runs inside this project's own Supabase edge
// function (supabase/functions/embed), next to the database that already holds the
// text. No outside AI service sees it, and it costs nothing per call.
//
// Server-only. The function accepts one caller: this server, presenting the project's
// secret key. Swap the provider here and nowhere else.

export const EMBED_MODEL = "gte-small";
export const EMBED_DIMS = 384;
/** Texts per request: small, so one call stays well inside the function's CPU limit. */
export const EMBED_BATCH = 8;
/** The model reads about 512 tokens; longer text is cut here rather than silently there. */
const MAX_CHARS = 1800;

const Reply = z.object({ embeddings: z.array(z.array(z.number()).length(EMBED_DIMS)).min(1).max(EMBED_BATCH) });

export function embeddingsConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SECRET_KEY);
}

/**
 * Embeds up to EMBED_BATCH texts. Returns null when embeddings are not set up or the
 * call fails: callers fall back to keyword search, so a failure is never an error page.
 */
export async function embedTexts(texts: readonly string[], timeoutMs = 20_000): Promise<number[][] | null> {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SECRET_KEY) return null;
  const inputs = texts.slice(0, EMBED_BATCH).map((t) => t.slice(0, MAX_CHARS));
  if (inputs.length === 0 || inputs.some((t) => !t.trim())) return null;
  const url = new URL("/functions/v1/embed", e.NEXT_PUBLIC_SUPABASE_URL);
  try {
    const raw = await safeFetchText(url.toString(), {
      method: "POST",
      body: JSON.stringify({ inputs }),
      // The secret key goes on `apikey` only: it is not a JWT, so it must not be sent as a bearer token.
      headers: { apikey: e.SUPABASE_SECRET_KEY, "content-type": "application/json" },
      accept: "application/json",
      // Trusted by server configuration: the project's own Supabase host.
      extraHosts: [url.hostname],
      timeoutMs,
      maxBytes: 400_000,
    });
    const parsed = Reply.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.embeddings.length !== inputs.length) {
      console.warn("[embeddings] unexpected reply shape");
      return null;
    }
    return parsed.data.embeddings;
  } catch (err) {
    // The error names the host and status only; the text is never logged.
    console.warn("[embeddings] request failed:", (err as Error).message?.slice(0, 120));
    return null;
  }
}

/** pgvector's text form. */
export const toVector = (v: readonly number[]): string => `[${v.join(",")}]`;
