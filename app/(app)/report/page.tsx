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
  examPaid: number;
  percentage: number | null;
}
interface LogEntry { date: string; status: string; note: string | null; upcoming: boolean }
type Period = "month" | "year" | "custom";

const isExam = (r: string | null) => !!r && /\bexam/i.test(r);
const barTone = (p: number | null) => (p === null ? "bg-border" : p >= 90 ? "bg-[var(--st-p-fg)]" : p >= 75 ? "bg-[var(--st-hd-fg)]" : "bg-[var(--st-ab-fg)]");

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-card p-0.5 shadow-soft">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cn("h-full rounded-md px-3 text-[13px] font-medium transition-all duration-200", value === k ? "bg-subtle text-fg shadow-sm" : "text-muted hover:text-fg")}>{l}</button>
      ))}
    </div>
  );
}

function Initials({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full border border-border-strong bg-subtle font-semibold text-fg-2", size === "lg" ? "h-11 w-11 text-sm" : "h-8 w-8 text-[11px]")}>
      {name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
    </div>
  );
}

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

  const totals = rows.reduce((t, r) => ({ wd: t.wd + r.workingDays, units: t.units + r.present + r.halfDays * 0.5, a: t.a + r.absent, hd: t.hd + r.halfDays, exam: t.exam + r.examPaid }), { wd: 0, units: 0, a: 0, hd: 0, exam: 0 });
  const avg = totals.wd ? Math.round((totals.units / totals.wd) * 1000) / 10 : null;
  const workingDays = rows.reduce((m, r) => Math.max(m, r.workingDays), 0);
  const absences = (detail.data?.log ?? []).filter((l) => l.status === "AB" || l.status === "HD");

  const pick = (id: string) => {
    setSelected(id);
    setTimeout(() => individualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Report</h1>
          <p className="mt-1 text-sm text-muted">Working days exclude Sundays. Holidays count as present. Future days are not counted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={period} onChange={setPeriod} options={[["month", "Month"], ["year", "Year"], ["custom", "Custom"]]} />
          {period === "month" && <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-32 animate-fade-in text-[13px]" aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}
          {period !== "custom" && <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24 text-[13px]" aria-label="Year">{Array.from({ length: 6 }, (_, i) => now.year - 4 + i).map((y) => <option key={y}>{y}</option>)}</Select>}
          {period === "custom" && (
            <span className="flex animate-fade-in items-center gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 text-[13px]" aria-label="From" />
              <span className="text-[13px] text-muted">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 text-[13px]" aria-label="To" />
            </span>
          )}
        </div>
      </div>

      {/* ---------------- Overall ---------------- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Overall attendance</h2>
          <span key={label} className="animate-fade-in text-[13px] text-muted">{label}</span>
        </div>
        {overall.error && <Card><EmptyState title="Could not load report" description={overall.error} /></Card>}
        {overall.loading && !overall.data ? <Skeleton className="h-96" /> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                { label: "Employees", value: rows.length },
                { label: "Working days", value: workingDays },
                { label: "Average attendance", value: avg === null ? "—" : `${avg}%` },
                { label: "Absences", value: totals.a, tone: "AB", sub: totals.exam ? `${totals.exam} exam · paid` : undefined },
                { label: "Half days", value: totals.hd, tone: "HD" },
              ].map((m, i) => (
                <div key={m.label} style={{ animationDelay: `${i * 50}ms` }} className="animate-fade-up rounded-xl border bg-card p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-pop">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">{m.tone && <span className={cn("h-1.5 w-1.5 rounded-full", `dot-${m.tone}`)} />}{m.label}</p>
                  <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{m.value}</p>
                  {m.sub && <p className="mt-0.5 text-xs text-[var(--st-p-fg)]">{m.sub}</p>}
                </div>
              ))}
            </div>

            <Card className="animate-fade-up overflow-hidden">
              {rows.length === 0 ? <EmptyState title="No working days in this period yet" /> : (
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-subtle text-left text-xs font-medium text-muted">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Employee</th>
                        <th className="px-3 py-2.5 text-right font-medium">Working days</th>
                        <th className="px-3 py-2.5 text-right font-medium">Present</th>
                        <th className="px-3 py-2.5 text-right font-medium">Half days</th>
                        <th className="px-3 py-2.5 text-right font-medium">Absent</th>
                        <th className="px-3 py-2.5 text-right font-medium">Exam (paid)</th>
                        <th className="px-4 py-2.5 font-medium">Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.employeeId} onClick={() => pick(r.employeeId)} style={{ animationDelay: `${i * 30}ms` }}
                          className={cn("group animate-fade-up cursor-pointer border-b transition-colors last:border-0 hover:bg-subtle/70", selected === r.employeeId && "bg-subtle")}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Initials name={r.name} />
                              <div className="leading-tight">
                                <p className="text-[13px] font-medium text-fg">{r.name}</p>
                                <p className="font-mono text-[11px] text-muted">{r.empCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-fg-2">{r.workingDays}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-fg-2">{r.present}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{r.halfDays ? <span className="st st-HD rounded-md px-1.5 py-0.5 text-xs font-semibold">{r.halfDays}</span> : <span className="text-muted">0</span>}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{r.absent ? <span className="st st-AB rounded-md px-1.5 py-0.5 text-xs font-semibold">{r.absent}</span> : <span className="text-muted">0</span>}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{r.examPaid ? <span className="st st-P rounded-md px-1.5 py-0.5 text-xs font-semibold">{r.examPaid}</span> : <span className="text-muted">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-subtle"><div className={cn("bar-grow h-1.5 rounded-full", barTone(r.percentage))} style={{ width: `${r.percentage ?? 0}%`, animationDelay: `${i * 30}ms` }} /></div>
                              <span className="w-12 text-[13px] font-semibold tabular-nums">{r.percentage === null ? "—" : `${r.percentage}%`}</span>
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
      <section ref={individualRef} className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Individual attendance</h2>
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-60 text-[13px]" aria-label="Employee">
            {rows.map((r) => <option key={r.employeeId} value={r.employeeId}>{r.name} · {r.empCode}</option>)}
          </Select>
        </div>

        {person && (
          <Card key={person.employeeId} className="animate-fade-up overflow-hidden">
            <div className="flex flex-col gap-5 border-b p-5 md:flex-row md:items-center">
              <div className="flex items-center gap-3 md:w-64">
                <Initials name={person.name} size="lg" />
                <div>
                  <p className="text-[15px] font-semibold">{person.name}</p>
                  <p className="text-[13px] text-muted"><span className="font-mono text-xs">{person.empCode}</span> · {label}</p>
                </div>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
                {[
                  { label: "Working days", value: person.workingDays },
                  { label: "Present", value: person.present, tone: "P" },
                  { label: "Half days", value: person.halfDays, tone: "HD" },
                  { label: "Absent", value: person.absent, tone: "AB", sub: person.examPaid ? `${person.examPaid} exam · paid` : undefined },
                  { label: "Attendance", value: person.percentage === null ? "—" : `${person.percentage}%` },
                ].map((m, i) => (
                  <div key={m.label} style={{ animationDelay: `${i * 40}ms` }} className="animate-fade-in bg-card px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs text-muted">{m.tone && <span className={cn("h-1.5 w-1.5 rounded-full", `dot-${m.tone}`)} />}{m.label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{m.value}</p>
                    {m.sub && <p className="text-[11px] text-[var(--st-p-fg)]">{m.sub}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                Absent &amp; half-day dates
                <span className="rounded-md border bg-subtle px-1.5 py-0.5 text-xs font-medium text-fg-2">{absences.length}</span>
              </h3>
              {detail.loading && !detail.data ? <Skeleton className="h-24" /> : absences.length === 0 ? (
                <p className="animate-fade-up rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-muted">No absences or half days in this period.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {absences.map((l, i) => (
                    <li key={l.date} style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}
                      className={cn("flex animate-fade-up items-center gap-3 rounded-lg border bg-card p-2.5 transition duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop", l.upcoming && "opacity-60")}>
                      <div className={cn("st flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md", `st-${l.status}`)}>
                        <span className="text-sm font-semibold leading-none">{Number(l.date.slice(8))}</span>
                        <span className="mt-0.5 text-[9px] font-medium uppercase">{MONTHS[Number(l.date.slice(5, 7)) - 1].slice(0, 3)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium">
                          {WEEKDAYS_SHORT[weekday(l.date)]}, {formatDate(l.date)}
                          <span className={cn("st rounded px-1 text-[10px] font-semibold", `st-${l.status}`)}>{l.status}</span>
                          {l.upcoming && <span className="text-[11px] font-normal text-muted">planned</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {l.note || "No reason given"}
                          {l.status === "AB" && isExam(l.note) && <span className="ml-1 font-medium text-[var(--st-p-fg)]">· paid, no LOP</span>}
                        </p>
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
