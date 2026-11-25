import "server-only";
import { cookies } from "next/headers";
import { CONSENT_COOKIE, consentPath, isAuthorizationId } from "./auth";

/**
 * Where to go once sign-in and MFA are done: back to Claude's consent request when one was
 * interrupted by sign-in (the gate set the cookie), else home. `clear` deletes the cookie;
 * only a server action or route may, so pages pass false.
 */
export async function afterSignIn(clear: boolean): Promise<string> {
  const jar = await cookies();
  const id = jar.get(CONSENT_COOKIE)?.value;
  if (clear && id) jar.delete(CONSENT_COOKIE);
  return isAuthorizationId(id) ? consentPath(id) : "/";
}
