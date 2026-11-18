import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function bearerMatches(header: string | null, expected: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}
