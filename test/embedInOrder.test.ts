import { describe, expect, it } from "vitest";
import { embedInOrder } from "@/lib/knowledge/embedInOrder";

const texts = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const vec = (t: string) => [Number(t.slice(1))];

describe("embedInOrder", () => {
  it("returns one vector per text, in order, and never runs two requests at once", async () => {
    let open = 0;
    let most = 0;
    const sizes: number[] = [];
    const out = await embedInOrder(texts(10), async (b) => {
      most = Math.max(most, ++open);
      sizes.push(b.length);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return b.map(vec);
    });
    expect(out).toEqual(texts(10).map(vec));
    expect(most).toBe(1);
    expect(sizes).toEqual([4, 4, 2]);
  });

  it("halves the request when one is too much, and keeps the smaller size", async () => {
    const sizes: number[] = [];
    const out = await embedInOrder(texts(6), async (b) => {
      sizes.push(b.length);
      return b.length > 2 ? null : b.map(vec);
    });
    expect(out).toEqual(texts(6).map(vec));
    expect(sizes).toEqual([4, 2, 2, 2]);
  });

  it("retries a single text after a pause, then carries on", async () => {
    let fails = 2;
    const out = await embedInOrder(texts(2), async (b) => (fails-- > 0 ? null : b.map(vec)), { batch: 1, pauseMs: 0 });
    expect(out).toEqual(texts(2).map(vec));
  });

  it("gives up when the function will not answer", async () => {
    let calls = 0;
    const out = await embedInOrder(texts(8), async () => (calls++, null), { pauseMs: 0 });
    expect(out).toBeNull();
    // 4, 2, 1, then two more tries of one text.
    expect(calls).toBe(5);
  });

  it("treats a short reply as a failure and stops at the deadline", async () => {
    expect(await embedInOrder(texts(1), async () => [], { pauseMs: 0 })).toBeNull();
    expect(await embedInOrder(texts(4), async (b) => b.map(vec), { deadline: Date.now() - 1 })).toBeNull();
  });

  it("returns an empty list for no texts", async () => {
    expect(await embedInOrder([], async () => null)).toEqual([]);
  });
});
