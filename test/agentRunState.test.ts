import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "@/lib/data/supabase";
import { startState } from "@/lib/domain/agentState";

const dir = join(__dirname, "..", "supabase", "migrations");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const OWNER = "00000000-0000-4000-8000-000000000001";

/** A client that records the table each query touches. */
function fakeClient() {
  const tables: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "upsert"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  const db = { from: (t: string) => (tables.push(t), chain) } as unknown as SupabaseClient;
  return { db, tables };
}

describe("Agent run state", () => {
  it("saves and loads in agent_run_state, never in the pause table", async () => {
    const { db, tables } = fakeClient();
    const store = createSupabaseStore(db, OWNER);
    await store.agentRunState.save("r1", "pitch", "running", startState("pitch", "g", [], { steps: 1, calls: 1 }, "x"));
    await store.agentRunState.get("r1");
    await store.agentRunState.recent("pitch", 5);
    expect(tables).toEqual(["agent_run_state", "agent_run_state", "agent_run_state"]);
  });

  it("the migration creates the table, reads only for you, and restores the pause switches", () => {
    const sql = read("20261124070000_agent_run_state.sql");
    expect(sql).toContain("create table if not exists public.agent_run_state");
    expect(sql).toContain("unique (owner_id, run_id)");
    expect(sql).toContain("grant select on public.agent_run_state to authenticated;");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*agent_run_state/);
    expect(sql).toContain("grant select, insert, update, delete on public.agent_state to authenticated;");
  });

  it("no migration creates a table an earlier migration already created", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      for (const m of read(f).matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
        const t = m[1]!;
        if (seen.has(t)) clashes.push(`${t}: ${seen.get(t)} and ${f}`);
        else seen.set(t, f);
      }
    }
    // The one known clash, fixed by 20261124070000_agent_run_state.
    expect(clashes).toEqual(["agent_state: 20261113075745_agents.sql and 20261124030000_agent_runtime.sql"]);
  });
});
