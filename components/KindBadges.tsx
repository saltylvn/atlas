import { AI_USE, KIND_COLOR, KINDS, REACH, TRIGGER, type AiUse, type Kind, type Reach, type Trigger } from "@/lib/domain/registry";
import { Pill } from "./ui";

/** Workflow, Bot or Agent: the one label that says who picks the next step. Same hue everywhere. */
export function KindPill({ kind }: { kind: Kind }) {
  return (
    <Pill color={KIND_COLOR[kind]}>
      <span title={KINDS[kind].definition}>{KINDS[kind].label}</span>
    </Pill>
  );
}

/** The three tags beside the kind: AI use, reach and trigger. Grey, except acting outside Atlas. */
export function Tags({ ai, reach, trigger, className = "" }: { ai?: AiUse; reach: Reach; trigger: Trigger; className?: string }) {
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {ai && (
        <span className="chip" title={AI_USE[ai].definition}>
          {ai === "ai-assisted" ? "✦ " : ""}
          {AI_USE[ai].label}
        </span>
      )}
      <span className="chip" title={REACH[reach].definition} style={reach === "outside" ? { color: "color-mix(in oklab, var(--c-warn) 70%, var(--ink))" } : undefined}>
        {REACH[reach].label}
      </span>
      <span className="chip">{TRIGGER[trigger].label}</span>
    </span>
  );
}
