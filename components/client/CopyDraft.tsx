"use client";

import { useState, useTransition } from "react";
import { recordJobDraftCopied } from "@/app/actions/jobs";
import { Icon } from "../Icon";

/** Copies a ready-made draft to the clipboard. The owner sends it from their own app. */
export function CopyDraft({ itemId, company, subject, body }: { itemId: string; company: string; subject: string; body: string }) {
  const [copied, setCopied] = useState(false);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm min-h-11"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${subject}\n\n${body}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          start(() => void recordJobDraftCopied(itemId, company));
        } catch {
          setCopied(false);
        }
      }}
    >
      <Icon name={copied ? "check" : "mail"} size={14} /> {copied ? "Copied" : "Copy draft"}
    </button>
  );
}
