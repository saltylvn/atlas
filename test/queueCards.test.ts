import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Apply Queue as cards you work through (owner's request, 23 Nov 2026): each job is its
// own box; Not a Good Fit (and the other ways a job leaves) closes that job in place, the page
// keeps what you opened, and the next job takes focus.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("The Apply Queue's cards", () => {
  it("lists each job as its own card", () => {
    const queue = read("components/ApprovalQueue.tsx");
    expect(queue).toContain("<QueueList>");
    expect(queue).toContain("<QueueItem key={a.id} id={a.id} label={a.title}>");
    expect(queue).not.toContain('<ul className="divide-y divide-line">\n          {pending.map');
    expect(read("components/client/QueueList.tsx")).toMatch(/rounded-xl border border-line-strong bg-surface p-3/);
  });

  it("closes a job in place when it leaves the queue, says so, and moves focus to the next", () => {
    const list = read("components/client/QueueList.tsx");
    expect(list).toContain("if (list?.hidden.has(id)) return null;");
    expect(list).toContain('role="status"');
    expect(list).toMatch(/next\?\.focus\(\)/);
    const buttons = read("components/client/CareerActions.tsx");
    expect(buttons).toContain("const closeItem = useCloseItem();");
    expect(buttons).toMatch(/markNotAGoodFit\(id\);\s+done\(r, "Not a good fit: closed out/);
  });

  it("never refolds or reopens a list after an action: your choice stays", () => {
    expect(read("components/ui.tsx")).toContain('<FoldDetails defaultOpen={alwaysOpen || count <= FOLD_OVER} className="group/fold">');
    const fold = read("components/client/FoldDetails.tsx");
    expect(fold).toContain("useState(defaultOpen)");
    expect(fold).toContain("onToggle");
  });
});
