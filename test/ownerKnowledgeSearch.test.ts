import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "@/lib/data/supabase";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const OWNER = "00000000-0000-4000-8000-000000000001";

/** A client that records which function each search calls, and answers with one hit. */
function fakeClient() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const row = { id: "k1", source: "resume", source_id: "r1", chunk_index: 0, title: "Resume: Engineer", content: "Built Python and SQL workflows", href: "", occurred_at: null, lexical_rank: 1, semantic_rank: null, similarity: null };
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: [row], error: null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("Knowledge search from server-side jobs", () => {
  it("the secret-key store searches as the owner, so the MCP server and agents find resumes", async () => {
    const { db, calls } = fakeClient();
    const found = await createSupabaseStore(db, OWNER).knowledge.search({ terms: ["python", "sql"], embedding: null, limit: 12, sources: ["resume", "project"] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("search_knowledge_for_owner");
    expect(calls[0]!.args).toMatchObject({ owner: OWNER, match_count: 12, sources: ["resume", "project"] });
    expect(found.lexical.map((h) => h.title)).toEqual(["Resume: Engineer"]);
  });

  it("a signed-in session keeps the auth.uid() search and never passes an owner id", async () => {
    const { db, calls } = fakeClient();
    await createSupabaseStore(db).knowledge.search({ terms: ["python"], embedding: null, limit: 5 });
    expect(calls[0]!.fn).toBe("search_knowledge");
    expect(calls[0]!.args).not.toHaveProperty("owner");
  });

  it("only the service role can call the owner search, and it keeps every guard", () => {
    const sql = read("supabase/migrations/20261124060000_owner_knowledge_search.sql");
    const sig = "public.search_knowledge_for_owner(uuid, text, text, integer, text[], timestamptz, timestamptz)";
    expect(sql).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function ${sig} to service_role;`);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toContain("set search_path = ''");
    // The same tsquery shape guard as search_knowledge: anything else matches nothing.
    expect(sql).toContain("terms ~ '^[a-z0-9]+( \\| [a-z0-9]+){0,15}$'");
    // Scoped to the owner passed in; a null owner matches nothing.
    expect(sql).toContain("where q.uid is not null and c.owner_id = q.uid");
    expect(sql).toContain("where c.owner_id = owner and");
    expect(sql).toContain("create or replace function");
  });
});
