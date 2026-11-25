import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Supabase records a migration by its version (the number before the first underscore) and
// applies each version once. Two files with the same version: the second is never applied.
// That happened on 24 Nov 2026 (agent_runtime and apply_briefs, both 20261124030000).

describe("Migrations", () => {
  it("each has a version of its own", () => {
    const files = readdirSync(join(__dirname, "..", "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const versions = files.map((f) => f.split("_")[0]!);
    const repeated = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect(repeated).toEqual([]);
    for (const v of versions) expect(v).toMatch(/^\d{14}$/);
  });
});
