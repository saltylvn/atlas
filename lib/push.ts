import "server-only";
import { sendNotification } from "web-push";
import type { Store } from "@/lib/data/store";
import { env } from "@/lib/env";

// Web push to the installed iPhone/iPad app (iOS 16.4+, Home Screen apps only).
// Payloads are end-to-end encrypted to the device by the Web Push protocol (RFC 8291);
// the push service (Apple, Google, Mozilla) relays ciphertext it cannot read.

/** Push services a subscription endpoint may point at. Anything else is refused (SSRF). */
const PUSH_HOSTS = ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com", "notify.windows.com"];

export function isAllowedEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function pushConfigured(): boolean {
  const e = env();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.ATLAS_OWNER_EMAIL);
}

export function vapidPublicKey(): string | null {
  return env().VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path to open when the notification is tapped. */
  url: string;
}

export async function sendToAll(store: Store, payload: PushPayload): Promise<{ sent: number; removed: number; failed: number }> {
  const e = env();
  if (!pushConfigured() || !e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return { sent: 0, removed: 0, failed: 0 };
  const body = JSON.stringify({ title: payload.title.slice(0, 80), body: payload.body.slice(0, 240), url: payload.url.startsWith("/") ? payload.url : "/" });
  const subs = await store.push.list();
  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      if (!isAllowedEndpoint(s.endpoint)) {
        await store.push.remove(s.endpoint);
        removed++;
        return;
      }
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: `mailto:${e.ATLAS_OWNER_EMAIL}`, publicKey: e.VAPID_PUBLIC_KEY!, privateKey: e.VAPID_PRIVATE_KEY! },
          TTL: 4 * 3600,
          urgency: "normal",
          timeout: 10_000,
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the device unsubscribed or the app was removed. Forget it.
        if (status === 404 || status === 410) {
          await store.push.remove(s.endpoint);
          removed++;
        } else {
          failed++;
        }
      }
    }),
  );
  return { sent, removed, failed };
}
