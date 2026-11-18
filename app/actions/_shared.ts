import "server-only";
import { z } from "zod";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/);
export const localDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** FormData -> plain object (single values only). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join(".") || "input"}: ${i.message}` : "Invalid input";
}
