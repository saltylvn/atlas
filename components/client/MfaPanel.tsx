"use client";

import { useState, useTransition } from "react";
import { startEnrollment, verifyTotp } from "@/app/actions/auth";

export function MfaPanel({ factorId: existing }: { factorId: string | null }) {
  const [factorId, setFactorId] = useState(existing);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!factorId) {
    return (
      <button
        type="button"
        className="btn btn-primary mt-5 w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startEnrollment();
            if (!r.ok) return setError(r.error);
            setFactorId(r.factorId);
            setQr(r.qr);
            setSecret(r.secret);
          })
        }
      >
        Show my setup code
      </button>
    );
  }

  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await verifyTotp(factorId, code);
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      {qr && (
        <div className="rounded-xl bg-white p-3">
          {/* Supabase returns the QR code as an SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Authenticator setup QR code" className="mx-auto h-44 w-44" />
          <p className="mt-2 break-all text-center font-mono text-[0.7rem] text-ink-3">{secret}</p>
        </div>
      )}
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="field text-center font-mono text-xl tracking-[0.4em]"
        aria-label="6-digit code"
        autoFocus
      />
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn btn-primary w-full" disabled={pending || code.length !== 6}>
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
