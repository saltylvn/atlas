"use client";

import { useMemo, useState } from "react";
import { ALL_UTAH, project, STATE_TILES, UTAH_OUTLINE, WASATCH_FRONT, type CityPin, type JobMaps, type MapJob } from "@/lib/domain/jobMap";
import { UTAH_CITIES } from "@/lib/domain/places";

/** The map is drawn this tall in its own units, about the height it is shown at, so text keeps its size. */
const MAP_H = 460;
const HOME = UTAH_CITIES.find((c) => c.name === "Salt Lake City")!;

function JobList({ title, jobs, onClose }: { title: string; jobs: MapJob[]; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-line p-3" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {title} · {jobs.length} job{jobs.length === 1 ? "" : "s"}
        </p>
        <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="mt-1 max-h-72 divide-y divide-line overflow-y-auto text-sm">
        {jobs.slice(0, 60).map((j, i) => (
          <li key={`${j.url}-${i}`} className="py-1.5">
            <a href={j.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              {j.title}
            </a>
            <span className="text-ink-3"> · {j.company}</span>
          </li>
        ))}
      </ul>
      {jobs.length > 60 && <p className="mt-1 text-xs text-ink-3">Showing 60 of {jobs.length}.</p>}
    </div>
  );
}

/** Utah: a pin at each city local jobs name, sized by how many. */
export function UtahJobMap({ data }: { data: JobMaps["utah"] }) {
  const [zoom, setZoom] = useState<"front" | "all">("front");
  const [open, setOpen] = useState<string | null>(null);
  const bounds = zoom === "front" ? WASATCH_FRONT : ALL_UTAH;
  const { width: W, height, at } = useMemo(() => {
    const w = Math.min(760, Math.round((1000 * MAP_H) / project(bounds, 1000).height));
    return { width: w, ...project(bounds, w) };
  }, [bounds]);
  const inView = (p: { lat: number; lon: number }) => p.lat <= bounds.north && p.lat >= bounds.south && p.lon >= bounds.west && p.lon <= bounds.east;
  const outside = data.pins.filter((p) => !inView(p)).reduce((n, p) => n + p.jobs.length, 0);
  const outline = UTAH_OUTLINE.map(([lon, lat]) => at(lon, lat).join(",")).join(" ");
  const pin = data.pins.find((p) => p.city === open);
  const r = (p: CityPin) => Math.min(24, 6 + Math.sqrt(p.jobs.length) * 3);
  const [hx, hy] = at(HOME.lon, HOME.lat);
  const tab = (on: boolean) => `min-h-11 rounded-md px-3 text-sm font-medium ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Map area" className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
          <button type="button" aria-pressed={zoom === "front"} className={tab(zoom === "front")} onClick={() => setZoom("front")}>
            Wasatch Front
          </button>
          <button type="button" aria-pressed={zoom === "all"} className={tab(zoom === "all")} onClick={() => setZoom("all")}>
            All of Utah
          </button>
        </div>
        <p className="text-xs text-ink-3">
          {data.total.toLocaleString()} local jobs · {data.pins.length} cities{outside > 0 && zoom === "front" ? ` · ${outside} outside this view` : ""}
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <svg viewBox={`0 0 ${W} ${height}`} className="mx-auto block h-auto max-h-[30rem] w-auto max-w-full" role="group" aria-label={`Map of ${zoom === "front" ? "the Wasatch Front" : "Utah"}: a pin at each city with local tech jobs. Select a pin for its jobs.`}>
          <polygon points={outline} style={{ fill: "var(--surface-2)", stroke: "var(--line-strong)" }} strokeWidth={1.5} />
          {zoom === "front" &&
            UTAH_CITIES.filter((c) => inView(c) && !data.pins.some((p) => p.city === c.name) && ["Salt Lake City", "Ogden", "Provo", "Park City", "Tooele"].includes(c.name)).map((c) => {
              const [x, y] = at(c.lon, c.lat);
              return (
                <text key={c.name} x={x} y={y} fontSize={11} textAnchor="middle" className="fill-ink-3">
                  {c.name}
                </text>
              );
            })}
          {/* Home, and the edge of a 45-minute drive is not drawn: the pins carry the places. */}
          <g transform={`translate(${hx} ${hy})`} aria-hidden>
            <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" style={{ fill: "var(--surface)", stroke: "var(--ink)" }} strokeWidth={1.5} />
            <text x={9} y={4} fontSize={11} fontWeight={600} className="fill-ink">
              Home
            </text>
          </g>
          {data.pins.filter(inView).map((p) => {
            const [x, y] = at(p.lon, p.lat);
            const rad = r(p);
            const on = open === p.city;
            return (
              <g
                key={p.city}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${p.city}: ${p.jobs.length} job${p.jobs.length === 1 ? "" : "s"}`}
                style={{ cursor: "pointer" }}
                className="outline-none focus-visible:[&>circle:nth-child(2)]:stroke-[3]"
                onClick={() => setOpen(on ? null : p.city)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(on ? null : p.city);
                  }
                }}
              >
                <circle r={Math.max(14, rad + 4)} fill="transparent" />
                <circle r={rad} style={{ fill: on ? "var(--brand-solid)" : "color-mix(in oklab, var(--brand) 80%, var(--surface))", stroke: on ? "var(--ink)" : "var(--surface)" }} strokeWidth={2} />
                {rad >= 10 && (
                  <text y={4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
                    {p.jobs.length}
                  </text>
                )}
                <text x={rad + 4} y={4} fontSize={11.5} fontWeight={500} className="fill-ink-2" style={{ paintOrder: "stroke", stroke: "var(--surface-2)", strokeWidth: 3 }}>
                  {p.city}
                </text>
                <title>{`${p.city}: ${p.jobs.length} ${p.jobs.length === 1 ? "job" : "jobs"}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {pin && <JobList title={pin.city} jobs={pin.jobs} onClose={() => setOpen(null)} />}
      {data.noCity.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-2">{data.noCity.length} Utah jobs name no city (not pinned)</summary>
          <ul className="mt-2 divide-y divide-line">
            {data.noCity.slice(0, 40).map((j, i) => (
              <li key={`${j.url}-${i}`} className="py-1.5">
                <a href={j.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {j.title}
                </a>
                <span className="text-ink-3"> · {j.company}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">Show as a table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <caption className="sr-only">Local Utah tech jobs by city</caption>
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th scope="col" className="py-1.5 font-medium">City</th>
              <th scope="col" className="py-1.5 font-medium">Jobs</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.pins.map((p) => (
              <tr key={p.city} className="border-b border-line last:border-0">
                <td className="py-1.5">{p.city}</td>
                <td className="py-1.5">{p.jobs.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const TILE = 46;
const GAP = 4;

/** Remote USA: a tile per state; a remote job limited to some states shows in each of them. */
export function RemoteJobMap({ data }: { data: JobMaps["remote"] }) {
  const [open, setOpen] = useState<string | null>(null);
  const counts = Object.fromEntries(Object.entries(data.byState).map(([s, j]) => [s, j.length]));
  const max = Math.max(1, ...Object.values(counts));
  const listed = open === "anywhere" ? { title: "Anywhere in the U.S.", jobs: data.anywhere } : open ? { title: open, jobs: data.byState[open] ?? [] } : null;
  const w = 12 * (TILE + GAP);
  const h = 8 * (TILE + GAP);
  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <div className="overflow-x-auto rounded-xl border border-line bg-surface p-2">
          <svg viewBox={`0 0 ${w} ${h}`} className="block w-full min-w-[22rem]" role="group" aria-label="Map of U.S. states: remote jobs limited to a state show in it. Select a state for its jobs.">
            {Object.entries(STATE_TILES).map(([s, [c, r]]) => {
              const n = counts[s] ?? 0;
              const on = open === s;
              const fill = n === 0 ? "var(--surface-2)" : `color-mix(in oklab, var(--brand) ${Math.round(20 + 65 * Math.sqrt(n / max))}%, var(--surface))`;
              const dark = n > 0 && Math.sqrt(n / max) > 0.55;
              return (
                <g
                  key={s}
                  transform={`translate(${c * (TILE + GAP)} ${r * (TILE + GAP)})`}
                  role={n ? "button" : undefined}
                  tabIndex={n ? 0 : undefined}
                  aria-pressed={n ? on : undefined}
                  aria-label={`${s}: ${n} remote job${n === 1 ? "" : "s"} limited to it`}
                  style={{ cursor: n ? "pointer" : "default" }}
                  className="outline-none focus-visible:[&>rect]:stroke-[3]"
                  onClick={() => n && setOpen(on ? null : s)}
                  onKeyDown={(e) => {
                    if (n && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setOpen(on ? null : s);
                    }
                  }}
                >
                  <rect width={TILE} height={TILE} rx={6} strokeWidth={on ? 2.5 : 1} style={{ fill, stroke: on ? "var(--ink)" : "var(--line)" }} />
                  <text x={TILE / 2} y={n ? 19 : 28} textAnchor="middle" fontSize={11} fontWeight={600} style={{ fill: dark ? "#fff" : "var(--ink-2)" }}>
                    {s}
                  </text>
                  {n > 0 && (
                    <text x={TILE / 2} y={35} textAnchor="middle" fontSize={12} fontWeight={600} style={{ fill: dark ? "#fff" : "var(--ink)" }}>
                      {n}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <button type="button" onClick={() => setOpen(open === "anywhere" ? null : "anywhere")} aria-pressed={open === "anywhere"} className={`card card-pad min-h-11 text-left ${open === "anywhere" ? "border-ink" : ""}`}>
          <p className="text-xs text-ink-3">Anywhere in the U.S.</p>
          <p className="h-display mt-1 text-3xl font-medium">{data.anywhere.length.toLocaleString()}</p>
          <p className="mt-1 text-xs text-ink-3">Remote jobs open in every state: no place to pin. Select to list them.</p>
        </button>
      </div>
      {listed && <JobList title={listed.title} jobs={listed.jobs} onClose={() => setOpen(null)} />}
      <p className="text-xs text-ink-3">
        {data.total.toLocaleString()} remote jobs. A job limited to a few states counts in each of them, so the tiles add up to more than the jobs.
      </p>
    </div>
  );
}
