"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, EmptyState, Input, Select, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/client";
import { MONTHS, WEEKDAYS_SHORT, formatDate, isoDate, monthEnd, monthStart, parseISO, todayIST, weekday } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface Row {
  employeeId: string;
  empCode: string;
  name: string;
  workingDays: number;
  present: number;
  absent: number;
  halfDays: number;
  holidays: number;
  percentage: number | null;
}
interface LogEntry { date: string; status: string; note: string | null; upcoming: boolean }
type Period = "month" | "year" | "custom";

const pctColor = (p: number | null) => (p === null ? "text-muted" : "text-fg");
const barColor = (p: number | null) => (p === null ? "bg-border" : p >= 90 ? "bg-zinc-900" : p >= 75 ? "bg-zinc-500" : "bg-zinc-300");

export default function ReportPage() {
  const now = parseISO(todayIST());
  const [period, setPeriod] = useState<Period>("month");
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [from, setFrom] = useState(monthStart(now.year, now.month));
  const [to, setTo] = useState(todayIST());
  const [selected, setSelected] = useState("");
  const individualRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    if (period === "month") return { from: monthStart(year, month), to: monthEnd(year, month) };
    if (period === "year") return { from: isoDate(year, 1, 1), to: isoDate(year, 12, 31) };
    return { from, to };
  }, [period, year, month, from, to]);
  const valid = range.from <= range.to;
  const label = period === "month" ? `${MONTHS[month - 1]} ${year}` : period === "year" ? `${year}` : `${formatDate(from)} – ${formatDate(to)}`;

  const overall = useApi<{ rows: Row[] }>(valid ? `/api/report?from=${range.from}&to=${range.to}` : null);
  const rows = useMemo(() => overall.data?.rows ?? [], [overall.data]);
  useEffect(() => { if (!selected && rows.length) setSelected(rows[0].employeeId); }, [rows, selected]);
  const person = rows.find((r) => r.employeeId === selected);
  const detail = useApi<{ log: LogEntry[] }>(valid && selected ? `/api/report?from=${range.from}&to=${range.to}&employeeId=${selected}` : null);

  const totals = rows.reduce((t, r) => ({ wd: t.wd + r.workingDays, p: t.p + r.present, a: t.a + r.absent }), { wd: 0, p: 0, a: 0 });
  const avg = totals.wd ? Math.round((totals.p / totals.wd) * 1000) / 10 : null;
  const workingDays = rows.reduce((m, r) => Math.max(m, r.workingDays), 0);
  const holidays = rows.reduce((m, r) => Math.max(m, r.holidays), 0);

  const absences = (detail.data?.log ?? []).filter((l) => l.status === "AB" || l.status === "HD");

  const pick = (id: string) => {
    setSelected(id);
    setTimeout(() => individualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div className="space-y-10">
      {/* Header + period */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Report</h1>
          <p className="mt-1.5 text-sm text-muted">Working days exclude Sundays · public holidays count as present · future days are not counted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border bg-card p-0.5">
            {(["month", "year", "custom"] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn("h-8 rounded-[10px] px-3 text-sm font-medium transition", period === p ? "bg-primary text-primary-fg" : "text-muted hover:text-fg")}>
                {p === "month" ? "Month" : p === "year" ? "Year" : "Custom"}
              </button>
            ))}
          </div>
          {period === "month" && (
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 w-36 rounded-xl" aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
          )}
          {period !== "custom" && (
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-28 rounded-xl" aria-label="Year">{Array.from({ length: 6 }, (_, i) => now.year - 4 + i).map((y) => <option key={y}>{y}</option>)}</Select>
          )}
          {period === "custom" && (
            <>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 rounded-xl" aria-label="From" />
              <span className="text-sm text-muted">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 rounded-xl" aria-label="To" />
            </>
          )}
        </div>
      </div>

      {/* ---------------- Overall ---------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Overall attendance <span className="font-normal text-muted">· {label}</span></h2>
        {overall.error && <Card><EmptyState title="Could not load report" description={overall.error} /></Card>}
        {overall.loading && !overall.data ? <Skeleton className="h-96" /> : (
          <>
            <Card className="grid grid-cols-2 overflow-hidden lg:grid-cols-4">
              {[
                { label: "Employees", value: rows.length },
                { label: "Working days", value: workingDays },
                { label: "Average attendance", value: avg === null ? "—" : `${avg}%`, cls: pctColor(avg) },
                { label: "Total absences", value: totals.a, sub: holidays ? `${holidays} public holiday${holidays > 1 ? "s" : ""} in period` : undefined },
              ].map((m, i) => (
                <div key={m.label} className={cn("px-6 py-5", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i === 2 && "lg:border-l")}>
                  <p className="text-sm text-muted">{m.label}</p>
                  <p className={cn("mt-2 font-display text-3xl font-semibold tabular-nums tracking-tight", m.cls)}>{m.value}</p>
                  {m.sub && <p className="mt-1 text-xs text-muted">{m.sub}</p>}
                </div>
              ))}
            </Card>

            <Card className="overflow-hidden">
              {rows.length === 0 ? <EmptyState title="No working days in this period yet" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-subtle/50 text-left text-xs font-medium text-muted">
                      <tr>
                        <th className="px-6 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 text-right font-medium">Working days</th>
                        <th className="px-4 py-3 text-right font-medium">Present</th>
                        <th className="px-4 py-3 text-right font-medium">Half days</th>
                        <th className="px-4 py-3 text-right font-medium">Absent</th>
                        <th className="px-6 py-3 font-medium">Attendance %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.employeeId} onClick={() => pick(r.employeeId)} style={{ animationDelay: `${i * 35}ms` }}
                          className={cn("animate-fade-up cursor-pointer border-b transition-colors last:border-0 hover:bg-subtle/60", selected === r.employeeId && "bg-subtle")}>
                          <td className="px-6 py-3.5"><span className="font-medium">{r.name}</span> <span className="ml-1 text-xs text-muted">{r.empCode}</span></td>
                          <td className="px-4 py-3.5 text-right tabular-nums">{r.workingDays}</td>
                          <td className="px-4 py-3.5 text-right tabular-nums">{r.present}</td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-muted">{r.halfDays}</td>
                          <td className="px-4 py-3.5 text-right tabular-nums font-medium">{r.absent}</td>
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="h-1.5 w-36 overflow-hidden rounded-full bg-subtle"><div className={cn("bar-grow h-1.5 rounded-full", barColor(r.percentage))} style={{ width: `${r.percentage ?? 0}%` }} /></div>
                              <span className={cn("w-14 font-semibold tabular-nums", pctColor(r.percentage))}>{r.percentage === null ? "—" : `${r.percentage}%`}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </section>

      {/* ---------------- Individual ---------------- */}
      <section ref={individualRef} className="scroll-mt-20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Individual attendance <span className="font-normal text-muted">· {label}</span></h2>
          <Select value={selected} onChange={(e) => { setSelected(e.target.value); }} className="h-9 w-64 rounded-xl" aria-label="Employee">
            {rows.map((r) => <option key={r.employeeId} value={r.employeeId}>{r.name} · {r.empCode}</option>)}
          </Select>
        </div>

        {person && (
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-6 border-b p-6 md:flex-row md:items-center">
              <div className="flex items-center gap-4 md:w-72">
                <div className="flex h-12 w-12 animate-scale-in items-center justify-center rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 text-sm font-semibold text-white ring-4 ring-zinc-100">
                  {person.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div>
                  <p className="text-lg font-semibold">{person.name}</p>
                  <p className="text-sm text-muted">{person.empCode}</p>
                </div>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5">
                {[
                  { label: "Working days", value: person.workingDays },
                  { label: "Present", value: person.present },
                  { label: "Half days", value: person.halfDays },
                  { label: "Absent", value: person.absent },
                  { label: "Attendance", value: person.percentage === null ? "—" : `${person.percentage}%`, cls: pctColor(person.percentage) },
                ].map((m) => (
                  <div key={m.label} className="bg-card px-5 py-4">
                    <p className="text-xs text-muted">{m.label}</p>
                    <p className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", m.cls)}>{m.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                Absent &amp; half-day dates
                <span className="rounded-full bg-fg px-2 py-0.5 text-xs font-medium text-white">{absences.length}</span>
              </h3>
              {detail.loading && !detail.data ? <Skeleton className="h-24" /> : absences.length === 0 ? (
                <p className="animate-fade-up rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted">No absences or half days in this period</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {absences.map((l, i) => (
                    <li key={l.date} style={{ animationDelay: `${Math.min(i, 15) * 35}ms` }}
                      className={cn("animate-fade-up flex gap-3 rounded-xl border bg-card p-3 transition duration-300 hover:-translate-y-0.5 hover:shadow-md", l.upcoming && "opacity-60")}>
                      <div className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-white", l.status === "HD" ? "bg-zinc-400" : "bg-fg")}>
                        <span className="text-base font-semibold leading-none">{Number(l.date.slice(8))}</span>
                        <span className="text-[10px] uppercase">{MONTHS[Number(l.date.slice(5, 7)) - 1].slice(0, 3)}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{WEEKDAYS_SHORT[weekday(l.date)]}, {formatDate(l.date)} <span className="ml-1 rounded border px-1 text-[10px] font-semibold">{l.status}</span>{l.upcoming && <span className="ml-1.5 text-xs font-normal text-muted">(planned)</span>}</p>
                        <p className="text-sm text-muted">{l.note || "No reason given"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
