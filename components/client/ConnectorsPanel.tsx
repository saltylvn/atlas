"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { connectGmailAppPassword, disconnectGmail, sendTestPush, subscribePush, syncNotionNow, testAiModel, unsubscribePush } from "@/app/actions/connectors";
import { Icon } from "../Icon";

/** One tiny call to the configured model, to confirm a new key works. */
export function TestModelButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await testAiModel();
            setNote({ ok: r.ok, text: r.ok ? (r.message ?? "It works") : r.error });
          })
        }
      >
        <Icon name="sparkle" size={14} /> {pending ? "Asking…" : "Test the model"}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`} role="status">{note.text}</span>}
    </div>
  );
}

/** Reads the Resumes database in Notion now. Read-only: nothing in Notion changes. */
export function SyncNotionButton({ label = "Sync now" }: { label?: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncNotionNow();
            setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Synced") : r.error });
          })
        }
      >
        <Icon name="refresh" size={14} /> {pending ? "Reading Notion…" : label}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </div>
  );
}

export function DisconnectGmail() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() => {
          if (!confirm("Disconnect Gmail? Atlas deletes its stored access and the synced inbox.")) return;
          start(async () => {
            const r = await disconnectGmail();
            setNote(r.ok ? (r.message ?? "") : r.error);
          });
        }}
      >
        Disconnect
      </button>
      {note && <span className="text-xs text-ink-2">{note}</span>}
    </div>
  );
}

/** App-password form. The password field is never echoed back or kept in client state after submit. */
export function GmailAppPasswordForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState(connectGmailAppPassword, null as ActionResult | null);
  return (
    <form action={action} className="space-y-2" autoComplete="off">
      <label className="block">
        <span className="label">Gmail address</span>
        <input name="email" type="email" required defaultValue={defaultEmail} autoComplete="username" className="field" />
      </label>
      <label className="block">
        <span className="label">App password</span>
        <input
          name="appPassword"
          type="password"
          required
          minLength={16}
          maxLength={19}
          placeholder="abcd efgh ijkl mnop"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="field font-mono"
        />
      </label>
      <button className="btn btn-primary btn-sm" disabled={pending}>
        <Icon name="plug" size={14} /> {pending ? "Checking with Gmail…" : "Connect Gmail"}
      </button>
      {state && <p className={`text-sm ${state.ok ? "text-ink-2" : "text-bad"}`}>{state.ok ? state.message : state.error}</p>}
    </form>
  );
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "checking" | "unsupported" | "install" | "denied" | "off" | "on";

/**
 * Turns on the morning notification for this device. iPhone and iPad only allow web
 * push for apps added to the Home Screen, so it explains that step when needed.
 */
export function PushPanel({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        const ios = /iPhone|iPad/.test(navigator.userAgent);
        const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
        setState(ios && !standalone ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      setState(sub ? "on" : "off");
    };
    void check();
  }, []);

  const turnOn = () =>
    start(async () => {
      if (!publicKey) return setNote("Push is not configured on the server yet.");
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const json = sub.toJSON();
      const device = /iPad/.test(navigator.userAgent) ? "iPad" : /iPhone/.test(navigator.userAgent) ? "iPhone" : "Browser";
      const r = await subscribePush({ endpoint: json.endpoint, keys: json.keys, device });
      if (r.ok) {
        setEndpoint(sub.endpoint);
        setState("on");
        setNote("");
      } else {
        await sub.unsubscribe();
        setNote(r.error);
      }
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      if (endpoint) await unsubscribePush(endpoint);
      setEndpoint(null);
      setState("off");
    });

  const test = () =>
    start(async () => {
      const r = await sendTestPush();
      setNote(r.ok ? (r.message ?? "Sent") : r.error);
    });

  return (
    <div className="space-y-2">
      {state === "install" && (
        <p className="text-sm text-ink-2">
          On iPhone and iPad, notifications work once Atlas is on your Home Screen: in Safari tap Share, then <b>Add to Home Screen</b>, and open Atlas from
          there.
        </p>
      )}
      {state === "unsupported" && <p className="text-sm text-ink-2">This browser does not support web push.</p>}
      {state === "denied" && <p className="text-sm text-ink-2">Notifications are blocked. Allow them for Atlas in iOS Settings → Notifications, then come back.</p>}
      {(state === "off" || state === "on") && (
        <div className="flex flex-wrap items-center gap-2">
          {state === "off" ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={turnOn}>
              <Icon name="bell" size={14} /> Turn on for this device
            </button>
          ) : (
            <>
              <span className="pill" style={{ ["--pc" as string]: "var(--c-green)" }}>
                On for this device
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={test}>
                Send a test
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={turnOff}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}
      {note && <p className="text-xs text-ink-2">{note}</p>}
    </div>
  );
}
