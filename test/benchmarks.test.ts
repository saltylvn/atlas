import { describe, expect, it } from "vitest";
import { runBenchmarks } from "@/lib/agents/benchmarks";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { blsRequest, fredUrl, parseBls, parseFred, SERIES, summarize } from "@/lib/domain/benchmarks";
import { assertAllowed } from "@/lib/security/safeFetch";
import type { Context } from "@/lib/context";

// The BLS shape is copied from a real response on 22 Nov 2026 (values as published).
const BLS = {
  status: "REQUEST_SUCCEEDED",
  message: ["Unable to get Catalog Data for series JTS510000000000000JOL"],
  Results: {
    series: [
      {
        seriesID: "JTS510000000000000JOL",
        data: [
          { year: "2026", period: "M09", periodName: "September", latest: "true", value: "116", footnotes: [{ code: "P", text: "preliminary" }] },
          { year: "2026", period: "M08", periodName: "August", value: "91", footnotes: [{}] },
          { year: "2026", period: "M07", periodName: "July", value: "78", footnotes: [{}] },
          { year: "2025", period: "M09", periodName: "September", value: "100", footnotes: [{}] },
          { year: "2025", period: "M13", periodName: "Annual", value: "95", footnotes: [{}] },
        ],
      },
      { seriesID: "NOT_OURS", data: [{ year: "2026", period: "M09", value: "1", footnotes: [] }] },
    ],
  },
};

describe("BLS JOLTS", () => {
  it("reads monthly values, marks the preliminary month, and drops annual averages and unknown series", () => {
    const { points, error } = parseBls(BLS);
    expect(error).toBeNull();
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ seriesId: "JTS510000000000000JOL", period: "2026-09-01", value: 116, preliminary: true });
    expect(points.some((p) => p.period.endsWith("13-01"))).toBe(false);
  });

  it("reports a refused request instead of pretending it read nothing", () => {
    expect(parseBls({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold reached"] })).toEqual({ points: [], error: "daily threshold reached" });
    expect(parseBls("<html>")).toEqual({ points: [], error: "unexpected response" });
  });

  it("sends the key in the request body, never the URL, and asks for every BLS series", () => {
    const body = JSON.parse(blsRequest("secret-key-123", new Date("2026-11-22T12:00:00Z")));
    expect(body).toMatchObject({ registrationkey: "secret-key-123", startyear: "2024", endyear: "2026" });
    expect(body.seriesid).toEqual(SERIES.filter((s) => s.source === "bls").map((s) => s.id));
    expect(JSON.parse(blsRequest(undefined, new Date())).registrationkey).toBeUndefined();
  });
});

describe("FRED", () => {
  it("keeps one value per week, skipping missing ones", () => {
    const points = parseFred("IHLIDXUSTPSOFTDEVE", {
      observations: [
        { date: "2026-11-16", value: "61.2" },
        { date: "2026-11-18", value: "61.9" },
        { date: "2026-11-20", value: "." },
        { date: "2026-11-23", value: "62.4" },
      ],
    });
    expect(points.map((p) => [p.period, p.value])).toEqual([
      ["2026-11-16", 61.9],
      ["2026-11-23", 62.4],
    ]);
    expect(parseFred("X", { error: "bad key" })).toEqual([]);
  });

  it("builds a request on an allowed host", () => {
    expect(() => assertAllowed(fredUrl("IHLIDXUSTPSOFTDEVE", "k", new Date()))).not.toThrow();
    expect(() => assertAllowed("https://api.bls.gov/publicAPI/v2/timeseries/data/")).not.toThrow();
  });
});

describe("Summaries", () => {
  it("gives the latest value with its change against the month before and a year before", () => {
    const s = summarize(parseBls(BLS).points).find((x) => x.series.id === "JTS510000000000000JOL")!;
    expect(s.latest).toMatchObject({ period: "2026-09-01", value: 116 });
    expect(s.vsPrevious).toBe(27.5);
    expect(s.vsYearAgo).toBe(16);
    expect(summarize([]).every((x) => x.latest === null && x.vsPrevious === null)).toBe(true);
  });
});

describe("The weekly read", () => {
  const ctx = () => {
    const store = createMemoryStore(seedState(new Date("2026-11-23T01:00:00Z")));
    return { store, ctx: { mode: "demo", userId: "", store, settings: {} as Context["settings"], now: new Date("2026-11-23T01:00:00Z"), today: "2026-11-22", time: "18:00" } as unknown as Context };
  };

  it("stores BLS values, skips FRED without a key, and logs the run", async () => {
    const { store, ctx: c } = ctx();
    const calls: string[] = [];
    const res = await runBenchmarks(c, {
      trigger: "schedule",
      honorPause: false,
      persist: store,
      deps: {
        fetchJson: (async (url: string) => {
          calls.push(url);
          return BLS;
        }) as never,
      },
    });
    expect("missing" in res).toBe(false);
    if ("missing" in res) return;
    expect(res.sources).toEqual({ bls: "read", fred: "not set up" });
    expect(res.read).toBe(4);
    expect(calls).toEqual(["https://api.bls.gov/publicAPI/v2/timeseries/data/"]);
    expect((await store.benchmarks.since("2026-09-01")).find((p) => p.seriesId === "JTS510000000000000JOL")?.value).toBe(116);
    expect((await store.agentRuns.recent(5)).find((r) => r.task === "Read national benchmarks" && r.status === "succeeded")).toBeTruthy();
  });

  it("logs a failed run when BLS cannot be reached, and keeps what was stored", async () => {
    const { store, ctx: c } = ctx();
    const before = (await store.benchmarks.since("2000-01-01")).length;
    const res = await runBenchmarks(c, { trigger: "schedule", honorPause: false, persist: store, deps: { fetchJson: (async () => { throw new Error("api.bls.gov timed out"); }) as never } });
    expect("missing" in res ? res.missing : res.sources.bls).toMatch(/failed/);
    expect((await store.benchmarks.since("2000-01-01")).length).toBe(before);
  });
});
