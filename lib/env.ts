import "server-only";
import * as React from "react";
import { z } from "zod";

// Every setting the server reads, validated once. Secrets never leave the server:
// nothing here is prefixed NEXT_PUBLIC_ except the two Supabase values that are
// designed to be public (the publishable key only grants what RLS allows).

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  /** Server-only. Used by scheduled jobs (briefs, Gmail sync, job matches) and capture. */
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  /** The one account allowed in. Everyone else is signed out on arrival. */
  ATLAS_OWNER_EMAIL: z.email().optional(),
  /** The owner's Supabase user id, so scheduled jobs write rows the owner's RLS can read. */
  ATLAS_OWNER_USER_ID: z.uuid().optional(),
  /** Allows demo mode in a production build (for a preview deploy with no database). */
  ATLAS_DEMO: bool(false),
  ATLAS_TIMEZONE: z.string().default("America/Denver"),
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  /** Google Gemini API key (AI Studio). Use a project with billing on: free-tier prompts may be used by Google. */
  GEMINI_API_KEY: z.string().min(20).max(200).optional(),
  /** Which model provider runs when both keys are set. Unset: Claude if it has a key, else Gemini. */
  ATLAS_AI_PROVIDER: z.enum(["anthropic", "gemini"]).optional(),
  /** Optional Gemini model ids, to change models without a code change. */
  ATLAS_GEMINI_MODEL_FAST: z.string().regex(/^gemini-[a-z0-9.-]{1,60}$/).optional(),
  ATLAS_GEMINI_MODEL_WRITER: z.string().regex(/^gemini-[a-z0-9.-]{1,60}$/).optional(),
  ATLAS_AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(500).default(60),
  /** Bearer token for the scheduled keep-alive call (32+ characters). */
  ATLAS_KEEPALIVE_TOKEN: z.string().min(32).optional(),
  /** Secret iCal address of your calendar (Google: Settings > Integrate calendar). */
  CALENDAR_ICS_URL: z.url().optional(),
  /** Notion internal integration secret (read-only). Lets Atlas read the Resumes database in Atlas HQ. */
  NOTION_TOKEN: z.string().min(20).max(200).optional(),
  // Figma personal access token, scope "File content: read". Read-only: the resume frames.
  FIGMA_TOKEN: z.string().min(20).max(200).optional(),
  // GitHub, read-only: your login, and optionally a fine-grained token (read-only Contents and Metadata) to include private repositories.
  GITHUB_USER: z.string().min(1).max(60).optional(),
  GITHUB_TOKEN: z.string().min(20).max(300).optional(),
  /** Optional: the Resumes data source id. Without it, Atlas finds the shared database titled "Resumes". */
  NOTION_RESUMES_DATA_SOURCE_ID: z
    .string()
    .regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i)
    .optional(),
  /** The site's own https address, e.g. https://atlas-optim.vercel.app (OAuth redirects). */
  ATLAS_SITE_URL: z.url().optional(),
  /** 32 random bytes, base64. Encrypts stored OAuth tokens. Generate: openssl rand -base64 32 */
  ATLAS_VAULT_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "32 bytes, base64").optional(),
  /** Google OAuth client (Web) used to connect Gmail read-only. */
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  /** Web push (VAPID) keys. Generate: npx web-push generate-vapid-keys */
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/).optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/).optional(),
  /** Vercel sends it as a bearer token on scheduled (cron) calls. 32+ characters. */
  CRON_SECRET: z.string().min(32).optional(),
  /** Bearer token for the Siri Shortcut capture endpoint. 32+ characters. */
  ATLAS_CAPTURE_TOKEN: z.string().min(32).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    // Name the bad settings, never their values.
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid server settings: ${names}. See .env.example.`);
  }
  cached = parsed.data;
  // React taint: if a secret is ever passed toward a client component, rendering fails loudly.
  const taint = (React as unknown as { experimental_taintUniqueValue?: (msg: string, owner: object, value: string) => void })
    .experimental_taintUniqueValue;
  if (typeof taint === "function") {
    for (const key of [
      "SUPABASE_SECRET_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "CALENDAR_ICS_URL",
      "NOTION_TOKEN",
      "FIGMA_TOKEN",
      "GITHUB_TOKEN",
      "ATLAS_KEEPALIVE_TOKEN",
      "ATLAS_VAULT_KEY",
      "GOOGLE_CLIENT_SECRET",
      "VAPID_PRIVATE_KEY",
      "CRON_SECRET",
      "ATLAS_CAPTURE_TOKEN",
    ] as const) {
      const value = cached[key];
      if (value) taint(`Do not pass ${key} to the client.`, process, value);
    }
  }
  return cached;
}

export type Mode = "live" | "demo" | "misconfigured";

/**
 * live: Supabase is configured and an owner is named. Sign-in is required.
 * demo: no database, sample data in memory, nothing leaves the server. Only in
 *       development, or when ATLAS_DEMO is set explicitly.
 * misconfigured: production with neither. Fails closed: every page shows setup help.
 */
export function mode(e: Env = env()): Mode {
  const hasDb = Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (hasDb && e.ATLAS_OWNER_EMAIL) return "live";
  if (e.NODE_ENV !== "production" || e.ATLAS_DEMO) return "demo";
  return "misconfigured";
}
