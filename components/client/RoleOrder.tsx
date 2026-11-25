"use client";

import { useState, useTransition } from "react";
import { saveRoleOrder } from "@/app/actions/roles";
import { Icon } from "../Icon";

/**
 * Your target roles in order, on Target Roles. Move a role up or down, take one off, or add
 * one of the seven while you have fewer than seven, then Save. Atlas owns this list;
 * Notion keeps only the resume for each role.
 */
export function RoleOrder({ roles, choices, max, suggested = [] }: { roles: string[]; choices: string[]; max: number; suggested?: readonly string[] }) {
  const [list, setList] = useState(roles);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = list.join("\n") !== roles.join("\n");
  const addable = choices.filter((c) => !list.includes(c));

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
    setNote(null);
  };

  return (
    <div className="space-y-3">
      <ol className="divide-y divide-line rounded-lg border border-line" aria-label="Your target roles, first is most important">
        {list.map((role, i) => (
          <li key={role} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-5 font-mono text-xs text-ink-3" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink break-words">{role}</span>
            <button type="button" className="btn btn-ghost px-2" aria-label={`Move ${role} up`} disabled={i === 0 || pending} onClick={() => move(i, -1)}>
              <span className="inline-flex rotate-180"><Icon name="chevron" size={16} /></span>
            </button>
            <button type="button" className="btn btn-ghost px-2" aria-label={`Move ${role} down`} disabled={i === list.length - 1 || pending} onClick={() => move(i, 1)}>
              <Icon name="chevron" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-ghost px-2"
              aria-label={`Take ${role} off your list`}
              disabled={list.length === 1 || pending}
              onClick={() => {
                setList(list.filter((r) => r !== role));
                setNote(null);
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {list.length < max && addable.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <span>Add</span>
            <select
              className="field w-auto"
              value=""
              disabled={pending}
              onChange={(e) => {
                if (!e.target.value) return;
                setList([...list, e.target.value]);
                setNote(null);
              }}
            >
              <option value="">a role…</option>
              {addable.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!changed || pending}
          aria-busy={pending}
          onClick={() =>
            start(async () => {
              setNote(null);
              const res = await saveRoleOrder(list);
              setNote(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error });
            })
          }
        >
          {pending ? "Saving…" : "Save order"}
        </button>
        {suggested.length > 0 && list.join("\n") !== suggested.join("\n") && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => {
              setList([...suggested]);
              setNote({ ok: true, text: "Your main roles are in place. Save order to keep them." });
            }}
          >
            Use my main roles
          </button>
        )}
        {changed && !pending && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setList(roles);
              setNote(null);
            }}
          >
            Undo
          </button>
        )}
        {note && (
          <span role="status" className={`text-sm break-words ${note.ok ? "text-ink-2" : "text-bad"}`}>
            {note.text}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-3">At most {max} roles. Other titles fold into these (Integration and Forward Deployed Engineer count as AI Solutions Engineer, GTM Engineer as AI Automation Engineer).</p>
    </div>
  );
}
