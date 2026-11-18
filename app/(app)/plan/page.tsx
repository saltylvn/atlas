import { getContext } from "@/lib/context";
import { addDays, mondayOf, shortDate, weekOf, weekdayName } from "@/lib/domain/dates";
import { capacityFor, comparePriority, minutesLabel } from "@/lib/domain/planner";
import type { Task } from "@/lib/domain/types";
import { AddTaskForm, AutoPlanButton, GoalForm, GoalToggle } from "@/components/client/Forms";
import { RoutineCheck } from "@/components/client/RoutineCheck";
import { StatusSelect } from "@/components/client/StatusSelect";
import { TaskMenu } from "@/components/client/TaskMenu";
import { AreaDot, CardHeader, Empty, Meter, PageHeader, PriorityPill } from "@/components/ui";
import { WeekLoadCard } from "@/components/schedule";
import { loadWeekSchedule } from "@/lib/scheduling";

export const metadata = { title: "Plan" };

interface Group {
  key: string;
  title: string;
  color: string;
  tasks: Task[];
  capacity?: number;
}

export default async function PlanPage() {
  const ctx = await getContext();
  const { store, today, settings } = ctx;
  const [tasks, goals, routines] = await Promise.all([store.tasks.list(), store.goals.list(), store.routines.list()]);
  const weekPlan = await loadWeekSchedule(ctx, tasks);
  const week = weekOf(today);
  const monday = mondayOf(today);
  const thisWeekGoals = goals.filter((g) => g.weekOf === monday);
  const weekly = routines.filter((r) => r.slot === "weekly-review").sort((a, b) => a.position - b.position);

  const open = tasks.filter((t) => t.status !== "done" || t.day === today);
  const load = (day: string) => open.filter((t) => t.day === day && t.status !== "done").reduce((n, t) => n + t.estimateMin, 0);

  const groups: Group[] = [
    { key: "overdue", title: "Overdue", color: "var(--c-red)", tasks: open.filter((t) => t.status !== "done" && t.day !== null && t.day < today) },
    ...week
      .filter((d) => d >= today)
      .map((d, i) => ({
        key: d,
        title: i === 0 ? `Today · ${shortDate(d)}` : d === addDays(today, 1) ? `Tomorrow · ${shortDate(d)}` : shortDate(d),
        color: i === 0 ? "var(--brand)" : "var(--c-blue)",
        tasks: open.filter((t) => t.day === d),
        capacity: capacityFor(d, settings.dailyCapacityMin),
      })),
    { key: "later", title: "Later", color: "var(--c-teal)", tasks: open.filter((t) => t.status !== "done" && t.day !== null && t.day > week[6]!) },
    { key: "backlog", title: "Backlog", color: "var(--c-grey)", tasks: open.filter((t) => t.day === null) },
  ];

  const dayOptions = [...week.filter((d) => d >= today), ...weekOf(addDays(monday, 7))].map((d) => ({ value: d, label: shortDate(d) }));

  return (
    <div className="space-y-5">
      <PageHeader title="Plan your week" sub={`Week of ${shortDate(monday)} · ${minutesLabel(settings.dailyCapacityMin)} a weekday, half on weekends`} action={<AutoPlanButton />} />

      <section className="card card-pad">
        <div className="grid grid-cols-7 gap-1.5 md:gap-3">
          {week.map((d) => {
            const used = load(d);
            const cap = capacityFor(d, settings.dailyCapacityMin);
            const past = d < today;
            return (
              <div key={d} className={`rounded-lg p-1.5 text-center md:p-2.5 ${d === today ? "bg-brand-soft" : ""} ${past ? "opacity-45" : ""}`}>
                <p className={`text-[0.7rem] font-semibold md:text-xs ${d === today ? "text-brand" : "text-ink-3"}`}>{weekdayName(d).slice(0, 3)}</p>
                <p className="h-display text-base font-semibold md:text-lg">{Number(d.slice(8))}</p>
                <div className="mt-1.5">
                  <Meter value={used} max={cap} color="var(--c-green)" />
                </div>
                <p className="mt-1 hidden text-[0.68rem] text-ink-3 md:block">
                  {minutesLabel(used)} / {minutesLabel(cap)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <WeekLoadCard loads={weekPlan.loads} moves={weekPlan.moves} tasks={tasks} today={today} week={week} />

      <AddTaskForm days={dayOptions} />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {groups
            .filter((g) => g.tasks.length > 0 || g.key === "backlog" || g.key === today)
            .map((g) => {
              const sorted = [...g.tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || comparePriority(a, b));
              const minutes = g.tasks.filter((t) => t.status !== "done").reduce((n, t) => n + t.estimateMin, 0);
              return (
                <section key={g.key} className="card overflow-hidden" style={{ ["--group" as string]: g.color }}>
                  <header className="group-bar flex items-center justify-between gap-2 px-4 py-3">
                    <h2 className="h-display font-semibold" style={{ color: g.color === "var(--c-grey)" ? "var(--ink-2)" : g.color }}>
                      {g.title}
                    </h2>
                    <span className="text-xs text-ink-3">
                      {g.tasks.length} item{g.tasks.length === 1 ? "" : "s"} · {minutesLabel(minutes)}
                      {g.capacity ? ` of ${minutesLabel(g.capacity)}` : ""}
                    </span>
                  </header>
                  {sorted.length === 0 ? (
                    <div className="px-4 pb-4">
                      <Empty>{g.key === "backlog" ? "Backlog is clear." : "Nothing planned."}</Empty>
                    </div>
                  ) : (
                    <ul className="group-bar divide-y divide-line border-t border-line">
                      {sorted.map((t) => (
                        <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 xl:grid-cols-[minmax(0,1fr)_130px_96px_70px_110px]">
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-medium ${t.status === "done" ? "text-ink-3 line-through" : ""}`}>{t.title}</p>
                            <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-ink-3">
                              <AreaDot area={t.area} />
                              {t.energy === "deep" && <span>Deep work</span>}
                              {t.recurrence !== "none" && <span>Repeats {t.recurrence}</span>}
                              {g.key === "overdue" && t.day && <span className="text-bad">was {shortDate(t.day)}</span>}
                              <span className="xl:hidden">{minutesLabel(t.estimateMin)}</span>
                            </div>
                          </div>
                          <StatusSelect id={t.id} status={t.status} />
                          <span className="hidden xl:block">
                            <PriorityPill priority={t.priority} />
                          </span>
                          <span className="hidden text-right text-sm text-ink-2 xl:block">{minutesLabel(t.estimateMin)}</span>
                          <span className="col-span-2 flex justify-end xl:col-span-1">
                            <TaskMenu id={t.id} title={t.title} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
        </div>

        <aside className="space-y-5">
          <section className="card card-pad">
            <CardHeader title="This week's goals" hint="Three is the sweet spot." />
            {thisWeekGoals.length === 0 ? <Empty>No goals yet.</Empty> : thisWeekGoals.map((g) => <GoalToggle key={g.id} id={g.id} done={g.done} title={g.title} />)}
            <GoalForm />
          </section>
          <section className="card card-pad">
            <CardHeader title="Weekly review" hint="Sunday, 25 minutes. Resets the week." />
            {weekly.map((r) => (
              <RoutineCheck key={r.id} id={r.id} title={r.title} minutes={r.minutes} done={(r.lastDoneOn ?? "") >= monday} />
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
