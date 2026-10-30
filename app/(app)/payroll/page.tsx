"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, IndianRupee, Info, Loader2, Wallet } from "lucide-react";
import { Button, Card, EmptyState, Select, Skeleton } from "@/components/ui";
import { api, saveBlob, useApi } from "@/lib/client";
import { MONTHS, parseISO, todayIST } from "@/lib/dates";
import { cn, formatINR } from "@/lib/utils";

interface PayRow {
  employeeId: string;
  empCode: string;
  name: string;
  monthlySalary: number | null;
  employedDays: number;
  present: number;
  halfDays: number;
  absent: number;
  examPaid: number;
  holidays: number;
  lopDays: number;
  paidDays: number;
  perDay: number | null;
  lopDeduction: number | null;
  notJoinedDeduction: number | null;
  netPay: number | null;
}
interface Payroll { year: number; month: number; workingDays: number; monthComplete: boolean; rows: PayRow[] }

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Money({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 800);
      setShown(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatINR(Math.round(shown * 100) / 100)}</>;
}

export default function PayrollPage() {
  const now = parseISO(todayIST());
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [open, setOpen] = useState<string | null>(null);
  const salaryRef = useRef<HTMLDivElement>(null);
  const { data, loading, error, reload } = useApi<Payroll>(`/api/payroll?year=${year}&month=${month}`);
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const shift = (d: number) => {
    const idx = year * 12 + month - 1 + d;
    setYear(Math.floor(idx / 12));
    setMonth((idx % 12) + 1);
    setOpen(null);
  };

  const withSalary = rows.filter((r) => r.monthlySalary !== null);
  const totals = withSalary.reduce((t, r) => ({
    gross: t.gross + (r.monthlySalary ?? 0), net: t.net + (r.netPay ?? 0), lop: t.lop + (r.lopDeduction ?? 0), lopDays: t.lopDays + r.lopDays,
  }), { gross: 0, net: 0, lop: 0, lopDays: 0 });

  const focusSalary = (id: string) => {
    salaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => document.getElementById(`salary-${id}`)?.focus(), 450);
  };

  const exportCsv = () => {
    const esc = (v: string | number | null) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ["Emp ID", "Name", "Monthly salary", "Working days", "Days employed", "Present", "Half days", "Absent", "Exam absences (paid)", "LOP days", "Paid days", "Per-day", "LOP deduction", "Net pay"];
    const lines = rows.map((r) => [r.empCode, r.name, r.monthlySalary, data!.workingDays, r.employedDays, r.present, r.halfDays, r.absent, r.examPaid, r.lopDays, r.paidDays, r.perDay, r.lopDeduction, r.netPay].map(esc).join(","));
    saveBlob(new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" }), `payroll-${year}-${String(month).padStart(2, "0")}.csv`);
    toast.success("Payroll exported");
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Payroll</h1>
          <p className="mt-1 text-sm text-muted">Monthly pay calculated from attendance and each employee&apos;s monthly salary.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center rounded-lg border border-border-strong bg-card shadow-soft">
            <button onClick={() => shift(-1)} aria-label="Previous month" className="flex h-full w-8 items-center justify-center rounded-l-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronLeft className="h-4 w-4" /></button>
            <Select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-full w-[118px] rounded-none border-0 border-x bg-transparent text-[13px] font-medium shadow-none focus:ring-0">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            <Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-full w-[92px] rounded-none border-0 border-r bg-transparent pr-7 text-[13px] font-medium shadow-none focus:ring-0">
              {Array.from({ length: 6 }, (_, i) => now.year - 4 + i).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <button onClick={() => shift(1)} aria-label="Next month" className="flex h-full w-8 items-center justify-center rounded-r-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />Export</Button>
        </div>
      </div>

      {error && <Card><EmptyState title="Could not load payroll" description={error} /></Card>}
      {loading && !data ? <Skeleton className="h-96" /> : data && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-[13px] text-fg-2 shadow-soft">
            <Info className="h-4 w-4 shrink-0 text-muted" />
            <span><b>{data.workingDays}</b> working days in {MONTHS[month - 1]} (Mon–Sat, holidays paid). Per-day = salary ÷ {data.workingDays}. LOP days = absences (exam absences are paid) + ½ × half days.</span>
            {!data.monthComplete && <span className="st st-HD ml-auto rounded-md px-2 py-0.5 text-xs font-medium">Projected · month in progress</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Net payout", value: totals.net, money: true, strong: true },
              { label: "Total monthly salaries", value: totals.gross, money: true },
              { label: "LOP deductions", value: totals.lop, money: true, tone: "AB" },
              { label: "LOP days", value: totals.lopDays, sub: `${withSalary.length} of ${rows.length} employees have a salary set` },
            ].map((m, i) => (
              <div key={m.label} style={{ animationDelay: `${i * 60}ms` }}
                className={cn("animate-fade-up rounded-xl border bg-card p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-pop", m.strong && "border-border-strong")}>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">{m.tone && <span className={cn("h-1.5 w-1.5 rounded-full", `dot-${m.tone}`)} />}{m.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{m.money ? <Money value={m.value} /> : num(m.value)}</p>
                {m.sub && <p className="mt-0.5 text-xs text-muted">{m.sub}</p>}
              </div>
            ))}
          </div>

          <Card className="animate-fade-up overflow-hidden">
            {rows.length === 0 ? <EmptyState icon={<Wallet className="h-5 w-5" />} title="No employees in this month" /> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="border-b bg-subtle text-xs font-medium text-muted">
                    <tr>
                      <th className="w-8" />
                      <th className="px-3 py-2.5 text-left font-medium">Employee</th>
                      <th className="px-3 py-2.5 text-right font-medium">Monthly salary</th>
                      <th className="px-3 py-2.5 text-right font-medium">Days</th>
                      <th className="px-3 py-2.5 text-right font-medium">Present</th>
                      <th className="px-3 py-2.5 text-right font-medium">Half</th>
                      <th className="px-3 py-2.5 text-right font-medium">Absent</th>
                      <th className="px-3 py-2.5 text-right font-medium">LOP days</th>
                      <th className="px-3 py-2.5 text-right font-medium">Per day</th>
                      <th className="px-3 py-2.5 text-right font-medium">Deduction</th>
                      <th className="px-4 py-2.5 text-right font-medium">Net pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const set = r.monthlySalary !== null;
                      const expanded = open === r.employeeId;
                      return (
                        <Fragment key={r.employeeId}>
                          <tr onClick={() => set && setOpen(expanded ? null : r.employeeId)} style={{ animationDelay: `${i * 30}ms` }}
                            className={cn("group animate-fade-up border-b transition-colors last:border-0", set ? "cursor-pointer hover:bg-subtle/70" : "", expanded && "bg-subtle")}>
                            <td className="pl-3 text-muted">{set && <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", expanded ? "rotate-0" : "-rotate-90")} />}</td>
                            <td className="px-3 py-2.5">
                              <p className="text-[13px] font-medium text-fg">{r.name}</p>
                              <p className="font-mono text-[11px] text-muted">{r.empCode}</p>
                            </td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">
                              {set ? formatINR(r.monthlySalary) : (
                                <button onClick={(e) => { e.stopPropagation(); focusSalary(r.employeeId); }} className="rounded-md border border-dashed px-2 py-0.5 text-xs font-medium text-muted transition hover:border-fg/40 hover:text-fg">Set salary</button>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-fg-2">{r.employedDays}<span className="text-muted">/{data.workingDays}</span></td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-fg-2">{r.present}</td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{r.halfDays ? <span className="st st-HD rounded-md px-1.5 py-0.5 text-xs font-semibold">{r.halfDays}</span> : <span className="text-muted">0</span>}</td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">
                              {r.absent ? <span className="st st-AB rounded-md px-1.5 py-0.5 text-xs font-semibold">{r.absent}</span> : <span className="text-muted">0</span>}
                              {r.examPaid > 0 && <span className="ml-1 text-[11px] text-[var(--st-p-fg)]">{r.examPaid} exam</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[13px] font-medium tabular-nums">{num(r.lopDays)}</td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-fg-2">{set ? formatINR(r.perDay) : "—"}</td>
                            <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{set && r.lopDeduction ? <span className="text-[var(--st-ab-fg)]">−{formatINR(r.lopDeduction)}</span> : <span className="text-muted">—</span>}</td>
                            <td className="px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums">{set ? formatINR(r.netPay) : <span className="font-normal text-muted">—</span>}</td>
                          </tr>
                          {expanded && set && (
                            <tr className="border-b bg-subtle/60">
                              <td />
                              <td colSpan={10} className="px-3 py-3">
                                <div className="grid animate-slide-down gap-2 text-[13px] sm:grid-cols-3">
                                  <Step n={1} title="Per-day pay" calc={`${formatINR(r.monthlySalary)} ÷ ${data.workingDays} working days`} result={formatINR(r.perDay)} />
                                  <Step n={2} title="Paid days" calc={`${r.employedDays} days − ${num(r.lopDays)} LOP (${r.absent - r.examPaid} AB${r.examPaid ? `, ${r.examPaid} exam paid` : ""}${r.halfDays ? ` + ½ × ${r.halfDays} HD` : ""})`} result={`${num(r.paidDays)} days`} />
                                  <Step n={3} title="Net pay" calc={`${formatINR(r.perDay)} × ${num(r.paidDays)} days`} result={formatINR(r.netPay)} strong />
                                </div>
                                {r.employedDays < data.workingDays && (
                                  <p className="mt-2 text-xs text-muted">Joined during the month — paid for {r.employedDays} of {data.workingDays} working days.</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  {withSalary.length > 0 && (
                    <tfoot className="border-t bg-subtle/60 text-[13px] font-semibold">
                      <tr>
                        <td />
                        <td className="px-3 py-2.5">Total</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(totals.gross)}</td>
                        <td colSpan={4} />
                        <td className="px-3 py-2.5 text-right tabular-nums">{num(totals.lopDays)}</td>
                        <td />
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--st-ab-fg)]">{totals.lop ? `−${formatINR(totals.lop)}` : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(totals.net)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* ---------------- Salary assignment ---------------- */}
      <section ref={salaryRef} className="scroll-mt-20 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Monthly salary</h2>
          <p className="mt-0.5 text-[13px] text-muted">Enter each employee&apos;s monthly stipend. Payroll above updates as soon as you save.</p>
        </div>
        {data && <SalaryEditor rows={rows} onSaved={reload} />}
      </section>
    </div>
  );
}

function Step({ n, title, calc, result, strong }: { n: number; title: string; calc: string; result: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", strong && "border-border-strong")} style={{ animationDelay: `${n * 60}ms` }}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-fg">{n}</span>{title}</p>
      <p className="mt-1 text-xs text-fg-2">{calc}</p>
      <p className={cn("mt-0.5 tabular-nums", strong ? "text-base font-semibold" : "font-medium")}>{result}</p>
    </div>
  );
}

function SalaryEditor({ rows, onSaved }: { rows: PayRow[]; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(rows.map((r) => [r.employeeId, r.monthlySalary === null ? "" : String(r.monthlySalary)])));
  }, [rows]);

  const dirty = (r: PayRow) => (values[r.employeeId] ?? "") !== (r.monthlySalary === null ? "" : String(r.monthlySalary));

  const save = async (r: PayRow) => {
    if (!dirty(r)) return;
    const v = (values[r.employeeId] ?? "").trim();
    setSaving(r.employeeId);
    try {
      await api(`/api/employees/${r.employeeId}/salary`, { method: "PUT", body: { monthlySalary: v === "" ? null : Number(v) } });
      setSaved(r.employeeId);
      setTimeout(() => setSaved((s) => (s === r.employeeId ? null : s)), 1500);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    const changed = rows.filter(dirty);
    for (const r of changed) await save(r);
    if (changed.length) toast.success(`Saved ${changed.length} salar${changed.length === 1 ? "y" : "ies"}`);
  };

  const anyDirty = rows.some(dirty);

  return (
    <Card className="animate-fade-up overflow-hidden">
      <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
        {rows.map((r, i) => (
          <li key={r.employeeId} style={{ animationDelay: `${i * 25}ms` }}
            className={cn("flex animate-fade-up items-center gap-3 border-b px-4 py-2.5 transition-colors hover:bg-subtle/50", i % 2 === 0 && "sm:border-r")}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-subtle text-[11px] font-semibold text-fg-2">
              {r.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{r.name}</p>
              <p className="font-mono text-[11px] text-muted">{r.empCode}</p>
            </div>
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input id={`salary-${r.employeeId}`} inputMode="decimal" placeholder="Monthly amount"
                value={values[r.employeeId] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [r.employeeId]: e.target.value.replace(/[^\d.]/g, "") }))}
                onBlur={() => void save(r)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={cn("h-8 w-40 rounded-lg border border-border-strong bg-card pl-7 pr-8 text-right text-[13px] tabular-nums shadow-soft outline-none transition focus:border-fg/40 focus:ring-4 focus:ring-[var(--ring)]",
                  dirty(r) && "border-[var(--st-hd-fg)]")} />
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                {saving === r.employeeId ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                  : saved === r.employeeId ? <Check className="h-3.5 w-3.5 animate-pop text-[var(--st-p-fg)]" /> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t bg-subtle/50 px-4 py-2.5">
        <p className="text-xs text-muted">Saves automatically when you leave a field or press Enter. Leave blank to remove a salary.</p>
        <Button size="sm" onClick={saveAll} disabled={!anyDirty}>Save all</Button>
      </div>
    </Card>
  );
}
