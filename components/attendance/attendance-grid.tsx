"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Download, Info, Loader2, Lock, MoreHorizontal, Redo2, RotateCcw, Search, Undo2, X, AlertCircle, PartyPopper, TrendingUp, UserPlus, Users, UserCheck, UserX,
} from "lucide-react";
import { Button, Card, Dialog, EmptyState, Field, Input, Select, Skeleton, StatusChip, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { LOCAL_MODE, api, download } from "@/lib/client";
import { cn, fmtNum } from "@/lib/utils";
import { MONTHS, WEEKDAYS_SHORT, formatDate, parseISO, todayIST } from "@/lib/dates";
import { ABSENT_CODE, selectableStatuses, statusMap, type StatusDef } from "@/lib/status";
import { summarize } from "@/lib/payroll";
import type { GridCell, GridDay, GridRow, MonthGrid } from "@/lib/attendance";
import type { Role } from "@/lib/permissions";

type GridData = MonthGrid & { canEdit: boolean; role: Role };
type Pos = { r: number; c: number };
type Op = { r: number; c: number; status?: string; reset?: boolean; remarks?: string | null };
type HistoryCell = { employeeId: string; date: string; before: GridCell; after: GridCell };
type Popover =
  | { kind: "cell"; x: number; y: number; askReason?: boolean }
  | { kind: "column"; c: number; x: number; y: number }
  | { kind: "row"; r: number; x: number; y: number };

const ROW_H = 40;
const DAY_W = 38;
const CHECK_W = 0;
const CODE_W = 72;
const NAME_W = 168;
const LEFT_W = CHECK_W + CODE_W + NAME_W;
const SUM_W = 64;
const SUMMARY = [{ key: "present", label: "Present" }, { key: "absent", label: "Absent" }] as const;

const sameCell = (a: GridCell, b: GridCell) => a.status === b.status && a.source === b.source && (a.remarks ?? null) === (b.remarks ?? null);

export function AttendanceGrid() {
  const router = useRouter();
  const params = useSearchParams();
  const confirm = useConfirm();
  const now = parseISO(todayIST());
  const year = Number(params.get("year")) || now.year;
  const month = Number(params.get("month")) || now.month;
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  const [data, setData] = useState<GridData | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const undoStack = useRef<HistoryCell[][]>([]);
  const redoStack = useRef<HistoryCell[][]>([]);
  const [, forceHistory] = useState(0);
  const dragging = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const defs = useMemo(() => statusMap(data?.statuses ?? []), [data?.statuses]);
  const days = useMemo(() => data?.days ?? [], [data?.days]);
  const shortcuts = useMemo(() => new Map(selectableStatuses(data?.statuses ?? []).filter((s) => s.shortcut).map((s) => [s.shortcut!, s.code])), [data?.statuses]);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      if (department) qs.set("department", department);
      if (search.trim()) qs.set("search", search.trim());
      const d = await api<GridData>(`/api/attendance?${qs}`);
      setData(d);
      setRows(d.rows);
      undoStack.current = [];
      redoStack.current = [];
      setAnchor(null);
      setFocus(null);
      setChecked(new Set());
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year, month, department, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Scroll today's column into view on load.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !data) return;
    const idx = data.days.findIndex((d) => d.today);
    if (idx >= 0) el.scrollLeft = Math.max(0, idx * DAY_W - (el.clientWidth - LEFT_W) / 2);
  }, [data]);

  const goMonth = (y: number, m: number) => {
    const qs = new URLSearchParams(params.toString());
    qs.set("year", String(y));
    qs.set("month", String(m));
    router.replace(`?${qs}`);
  };
  const shiftMonth = (delta: number) => {
    const idx = year * 12 + month - 1 + delta;
    goMonth(Math.floor(idx / 12), (idx % 12) + 1);
  };

  // ---------------------------------------------------------------- virtualization
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (vItems.at(-1)?.end ?? 0);

  // ---------------------------------------------------------------- selection helpers
  const range = useMemo(() => {
    if (!anchor || !focus) return null;
    return { r0: Math.min(anchor.r, focus.r), r1: Math.max(anchor.r, focus.r), c0: Math.min(anchor.c, focus.c), c1: Math.max(anchor.c, focus.c) };
  }, [anchor, focus]);
  const selectedCount = range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;

  const ensureVisible = useCallback((p: Pos) => {
    virtualizer.scrollToIndex(p.r, { align: "auto" });
    const el = scrollRef.current;
    if (!el) return;
    const left = p.c * DAY_W;
    const viewW = el.clientWidth - LEFT_W - (window.innerWidth >= 1280 ? SUMMARY.length * SUM_W : 0);
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + DAY_W > el.scrollLeft + viewW) el.scrollLeft = left + DAY_W - viewW;
  }, [virtualizer]);

  // ---------------------------------------------------------------- mutations
  const commit = useCallback(async (entries: HistoryCell[], ops: { employeeId: string; date: string; status?: string; reset?: boolean; remarks?: string | null }[]) => {
    setPending((p) => p + 1);
    try {
      const res = await api<{ warnings: string[] }>("/api/attendance/bulk", { body: { changes: ops } });
      res.warnings.forEach((w) => toast.warning(w));
      setSaveState("saved");
      return true;
    } catch (e) {
      // Revert the optimistic change (only cells still showing our value).
      setRows((prev) => {
        const idx = new Map(prev.map((r, i) => [r.id, i]));
        const next = [...prev];
        for (const h of entries) {
          const ri = idx.get(h.employeeId);
          if (ri === undefined) continue;
          const ci = days.findIndex((d) => d.date === h.date);
          if (ci < 0 || !sameCell(next[ri].cells[ci], h.after)) continue;
          if (next[ri] === prev[ri]) next[ri] = { ...prev[ri], cells: [...prev[ri].cells] };
          next[ri].cells[ci] = h.before;
        }
        return next;
      });
      setSaveState("error");
      toast.error((e as Error).message || "Could not save — changes reverted");
      return false;
    } finally {
      setPending((p) => p - 1);
    }
  }, [days]);

  const applyOps = useCallback((ops: Op[], mode: "new" | "undo" | "redo" = "new"): number => {
    if (!data?.canEdit) {
      toast.error(data?.lock ? "This month is locked for payroll." : "You have read-only access.");
      return 0;
    }
    const current = rowsRef.current;
    const next = [...current];
    const entries: HistoryCell[] = [];
    const payload: { employeeId: string; date: string; status?: string; reset?: boolean; remarks?: string | null }[] = [];
    let skippedFuture = 0;
    for (const op of ops) {
      const row = next[op.r];
      const day = days[op.c];
      if (!row || !day) continue;
      const cell = row.cells[op.c];
      if (cell.def === "NA" || day.kind === "holiday") continue; // holidays are always H
      if (day.future && op.status && !defs.get(op.status)?.plannable) { skippedFuture++; continue; }
      let after: GridCell;
      if (op.reset) after = { status: cell.def, source: "AUTO", remarks: op.remarks !== undefined ? op.remarks : null, def: cell.def };
      else if (op.status) after = { status: op.status, source: "MANUAL", remarks: op.remarks !== undefined ? op.remarks : cell.remarks, def: cell.def };
      else if (op.remarks !== undefined) after = { ...cell, remarks: op.remarks };
      else continue;
      if (sameCell(cell, after) && !(op.reset && cell.source === "NONE")) continue;
      if (next[op.r] === current[op.r]) next[op.r] = { ...row, cells: [...row.cells] };
      next[op.r].cells[op.c] = after;
      entries.push({ employeeId: row.id, date: day.date, before: cell, after });
      payload.push({ employeeId: row.id, date: day.date, ...(op.reset ? { reset: true } : op.status ? { status: op.status } : {}), ...(op.remarks !== undefined ? { remarks: op.remarks } : {}) });
    }
    if (skippedFuture) toast.info(`${skippedFuture} future cell(s) skipped — only planned leave can be entered ahead.`);
    if (!entries.length) return 0;
    setRows(next);
    if (mode === "undo") redoStack.current.push(entries);
    else {
      undoStack.current.push(entries);
      if (undoStack.current.length > 100) undoStack.current.shift();
      if (mode === "new") redoStack.current = [];
    }
    forceHistory((n) => n + 1);
    void commit(entries, payload).then((ok) => {
      if (!ok) {
        const stack = mode === "undo" ? redoStack.current : undoStack.current;
        const i = stack.indexOf(entries);
        if (i >= 0) stack.splice(i, 1);
        forceHistory((n) => n + 1);
      }
    });
    return entries.length;
  }, [data?.canEdit, data?.lock, days, defs, commit]);

  const opsFromHistory = useCallback((entries: HistoryCell[], which: "before" | "after"): Op[] => {
    const idx = new Map(rowsRef.current.map((r, i) => [r.id, i]));
    return entries.flatMap((h) => {
      const r = idx.get(h.employeeId);
      const c = days.findIndex((d) => d.date === h.date);
      if (r === undefined || c < 0) return [];
      const v = h[which];
      return [v.source === "MANUAL" ? { r, c, status: v.status, remarks: v.remarks } : { r, c, reset: true, remarks: v.remarks }];
    });
  }, [days]);

  const undo = useCallback(() => {
    const entries = undoStack.current.pop();
    if (!entries) return;
    applyOps(opsFromHistory(entries, "before"), "undo");
  }, [applyOps, opsFromHistory]);

  const redo = useCallback(() => {
    const entries = redoStack.current.pop();
    if (!entries) return;
    applyOps(opsFromHistory(entries, "after"), "redo");
  }, [applyOps, opsFromHistory]);

  const applyToSelection = useCallback((op: Omit<Op, "r" | "c">) => {
    if (!range) return 0;
    const ops: Op[] = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) ops.push({ r, c, ...op });
    return applyOps(ops);
  }, [range, applyOps]);

  // ---------------------------------------------------------------- popovers
  const openCellPopover = useCallback((p: Pos, askReason = false) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${p.r}-${p.c}"]`);
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    setPopover({ kind: "cell", x: rect.left, y: rect.bottom + 4, askReason });
  }, []);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (focus && data?.canEdit) openCellPopover(focus);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [focus, data?.canEdit, openCellPopover]);

  // ---------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (popover && e.key === "Escape") { setPopover(null); return; }
    if (popover) return;
    if (!focus) {
      if (["ArrowDown", "ArrowRight", "Enter", "Tab"].includes(e.key) && rows.length) {
        e.preventDefault();
        const today = days.findIndex((d) => d.today);
        const p = { r: 0, c: Math.max(0, today) };
        setAnchor(p); setFocus(p);
      }
      return;
    }
    const move = (dr: number, dc: number, extend = false) => {
      const p = { r: Math.min(rows.length - 1, Math.max(0, focus.r + dr)), c: Math.min(days.length - 1, Math.max(0, focus.c + dc)) };
      setFocus(p);
      if (!extend) setAnchor(p);
      ensureVisible(p);
    };
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); return move(-1, 0, e.shiftKey);
      case "ArrowDown": e.preventDefault(); return move(1, 0, e.shiftKey);
      case "ArrowLeft": e.preventDefault(); return move(0, -1, e.shiftKey);
      case "ArrowRight": e.preventDefault(); return move(0, 1, e.shiftKey);
      case "Tab": e.preventDefault(); return move(0, e.shiftKey ? -1 : 1);
      case "Enter": e.preventDefault(); return move(e.shiftKey ? -1 : 1, 0);
      case "Escape": setAnchor(focus); return;
      case " ": case "F2": e.preventDefault(); return openCellPopover(focus);
      case "Delete": case "Backspace": e.preventDefault(); applyToSelection({ reset: true }); return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const code = shortcuts.get(e.key.toUpperCase());
    if (!code) return;
    e.preventDefault();
    if (code === ABSENT_CODE) return openCellPopover(focus, true); // absence always needs a reason
    applyToSelection({ status: code });
    if (selectedCount === 1) move(0, 1);
  };

  // ---------------------------------------------------------------- derived
  const summaries = useMemo(
    () => rows.map((r) => summarize(r.cells.map((c, i) => ({ status: c.status, companyWorking: days[i]?.kind === "working" })), defs, data?.basis ?? "calendar")),
    [rows, days, defs, data?.basis],
  );

  const focusCell = focus ? rows[focus.r]?.cells[focus.c] : null;

  // ---------------------------------------------------------------- render
  const header = (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-full border bg-card p-1 shadow-soft">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <Select aria-label="Month" value={month} onChange={(e) => goMonth(year, Number(e.target.value))} className="h-8 w-32 border-0 bg-transparent font-medium focus:ring-0">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
          <Select aria-label="Year" value={year} onChange={(e) => goMonth(Number(e.target.value), month)} className="h-8 w-28 border-0 bg-transparent font-medium focus:ring-0">
            {Array.from({ length: 9 }, (_, i) => now.year - 5 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {(year !== now.year || month !== now.month) && <Button variant="outline" size="sm" onClick={() => goMonth(now.year, now.month)}><CalendarDays className="h-3.5 w-3.5" />Today</Button>}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search employee" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-48 rounded-full pl-9" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SaveIndicator pending={pending} state={saveState} />
          <Button variant="ghost" size="icon" onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
          <ExportMenu year={year} month={month} department={department} />
          <Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" />Add employee</Button>
        </div>
      </div>
      {data?.lock && (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Lock className="h-4 w-4" /> Locked for payroll by {data.lock.lockedBy} on {new Date(data.lock.lockedAt).toLocaleDateString("en-IN")}. The grid is read-only.
          <Link href={`/payroll?year=${year}&month=${month}`} className="ml-auto font-medium underline">Payroll</Link>
        </div>
      )}
      {data && !data.canEdit && !data.lock && (
        <div className="flex items-center gap-2 rounded-2xl bg-subtle px-4 py-2.5 text-sm text-muted"><Info className="h-4 w-4" /> Read-only access.</div>
      )}
    </div>
  );

  if (loading && !data) return <div>{header}<GridSkeleton /></div>;
  if (loadError) return <div>{header}<Card><EmptyState icon={<AlertCircle className="h-5 w-5" />} title="Could not load attendance" description={loadError} action={<Button onClick={load}>Retry</Button>} /></Card></div>;
  if (!data) return null;

  return (
    <div>
      {header}
      {checked.size > 0 && data.canEdit && (
        <BulkBar count={checked.size} days={days} statuses={selectableStatuses(data.statuses)}
          onClear={() => setChecked(new Set())}
          onApply={async (fromIdx, toIdx, status) => {
            const ops: Op[] = [];
            rows.forEach((r, ri) => {
              if (!checked.has(r.id)) return;
              for (let c = fromIdx; c <= toIdx; c++) ops.push(status === "__reset" ? { r: ri, c, reset: true } : { r: ri, c, status });
            });
            const n = applyOps(ops);
            if (n) toast.success(`Updated ${n} cell(s)`);
          }} />
      )}

      {rows.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No employees yet" description="Add your first employee to start marking attendance." action={<Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" />Add employee</Button>} /></Card>
      ) : (
        <>
          <StatsRow rows={rows} days={days} defs={defs} />
          <DayMarker rows={rows} days={days} defs={defs} canEdit={data.canEdit}
            onSet={(r, c, status, reason) => applyOps([status === "__reset" ? { r, c, reset: true } : { r, c, status, remarks: reason ?? null }])} />

          {/* Monthly register (desktop / tablet) */}
          <div className="mb-3 mt-10 hidden items-end justify-between md:flex">
            <div>
              <h2 className="text-lg font-semibold">Monthly register</h2>
              <p className="text-sm text-muted">Click any box to change it · drag to select many · type <b>P</b> or <b>A</b></p>
            </div>
          </div>
          <Card className="hidden overflow-hidden md:block">
            <div ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} className="outline-none" aria-label="Attendance grid. Use arrow keys to move and letter shortcuts to set status.">
              <div ref={scrollRef} className="scrollbar-thin relative max-h-[calc(100vh-230px)] min-h-[320px] overflow-auto">
                <table className="border-separate border-spacing-0 text-xs" style={{ width: LEFT_W + days.length * DAY_W + SUMMARY.length * SUM_W }}>
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-30 border-b bg-card px-2 text-left font-medium text-muted" style={{ left: CHECK_W, width: CODE_W, minWidth: CODE_W }}>Emp ID</th>
                      <th className="sticky top-0 z-30 border-b border-r bg-card px-2 text-left font-medium text-muted" style={{ left: CHECK_W + CODE_W, width: NAME_W, minWidth: NAME_W }}>Employee</th>
                      {days.map((d, c) => (
                        <th key={d.date} style={{ width: DAY_W, minWidth: DAY_W }}
                          title={d.holiday ? `Holiday: ${d.holiday}` : d.override === true ? "Working day (override)" : d.kind === "weeklyOff" ? "Weekly off" : undefined}
                          onClick={(e) => { if (!data.canEdit) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPopover({ kind: "column", c, x: r.left, y: r.bottom + 4 }); }}
                          className={cn("sticky top-0 z-20 cursor-pointer select-none border-b py-1.5 text-center font-medium",
                            d.today ? "bg-accent text-white" : d.kind === "holiday" ? "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200" : d.kind === "weeklyOff" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" : "bg-card text-fg",
                            d.future && !d.today && "opacity-60")}>
                          <div className="text-[13px] leading-none">{d.day}</div>
                          <div className="mt-0.5 text-[9px] font-normal uppercase opacity-80">{WEEKDAYS_SHORT[d.weekday].slice(0, 2)}</div>
                        </th>
                      ))}
                      {SUMMARY.map((s, i) => (
                        <th key={s.key} className={cn("sticky top-0 z-30 border-b bg-subtle px-1 text-center text-[10px] font-medium leading-tight text-muted xl:right-[var(--r)]", i === 0 && "border-l", s.key === "absent" && "text-red-600 dark:text-red-400")}
                          style={{ width: SUM_W, minWidth: SUM_W, ["--r" as string]: `${(SUMMARY.length - 1 - i) * SUM_W}px` }}>{s.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={3 + days.length + SUMMARY.length} /></tr>}
                    {vItems.map((vi) => {
                      const r = vi.index;
                      const row = rows[r];
                      const s = summaries[r];
                      return (
                        <tr key={row.id} style={{ height: ROW_H }} className="group">
                          <td className="sticky z-10 border-b bg-card px-2 font-mono text-[11px] text-muted group-hover:bg-subtle" style={{ left: CHECK_W }}>{row.empCode}</td>
                          <td className="sticky z-10 border-b border-r bg-card px-2 group-hover:bg-subtle" style={{ left: CHECK_W + CODE_W }}>
                            <div className="flex items-center gap-1">
                              <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{row.name}</div>
                              {data.canEdit && (
                                <button aria-label={`Row actions for ${row.name}`} className="rounded-md p-1 text-muted opacity-0 hover:bg-border group-hover:opacity-100 focus:opacity-100"
                                  onClick={(e) => { const rc = e.currentTarget.getBoundingClientRect(); setPopover({ kind: "row", r, x: rc.left, y: rc.bottom + 4 }); }}>
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                          {row.cells.map((cell, c) => (
                            <GridCellView key={c} r={r} c={c} cell={cell} day={days[c]} def={defs.get(cell.status)}
                              selected={inRange(r, c)} focused={focus?.r === r && focus?.c === c}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                gridRef.current?.focus({ preventScroll: true });
                                setPopover(null);
                                const p = { r, c };
                                if (e.shiftKey && anchor) setFocus(p);
                                else { setAnchor(p); setFocus(p); }
                                dragging.current = true;
                              }}
                              onMouseEnter={() => { if (dragging.current) setFocus({ r, c }); }} />
                          ))}
                          {SUMMARY.map((sm, i) => (
                            <td key={sm.key} className={cn("z-10 border-b bg-subtle text-center tabular-nums xl:sticky xl:right-[var(--r)]", i === 0 && "border-l",
                              sm.key === "absent" && s.absent > 0 && "font-semibold text-red-600 dark:text-red-400")}
                              style={{ ["--r" as string]: `${(SUMMARY.length - 1 - i) * SUM_W}px` }}>{fmtNum(s[sm.key])}</td>
                          ))}
                        </tr>
                      );
                    })}
                    {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={3 + days.length + SUMMARY.length} /></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-[11px] text-muted">
              {selectableStatuses(data.statuses).map((s) => (
                <span key={s.code} className="inline-flex items-center gap-1.5">
                  <StatusChip def={s} code={s.code} />{s.label}{s.shortcut && <kbd className="rounded border px-1 font-mono text-[10px]">{s.shortcut}</kbd>}
                </span>
              ))}
              <span className="ml-auto inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm border-l-[6px] border-t-[6px] border-l-accent border-t-transparent" /> Edited by HR</span>
                <span className="inline-flex items-center gap-1.5"><StatusChip def={defs.get("H")} code="H" />Holiday (counted Present)</span>
                <span className="inline-flex items-center gap-1.5"><StatusChip def={defs.get("WO")} code="WO" />Sunday off</span>
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Has reason (hover to read)</span>
                <span>Type P, or A for AB · Del = reset · Ctrl+Z undo</span>
              </span>
            </div>
          </Card>

        </>
      )}

      <AddEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void load(); }} />

      {popover && (
        <FloatingPanel x={popover.x} y={popover.y} onClose={() => setPopover(null)}>
          {popover.kind === "cell" && focus && focusCell && (
            <CellPanel
              title={selectedCount > 1 ? `${selectedCount} cells selected` : `${rows[focus.r].name} · ${formatDate(days[focus.c].date, "long")}`}
              subtitle={selectedCount === 1 ? (focusCell.def === "NA" ? "Not employed on this date" : days[focus.c].kind === "holiday" ? `Public holiday: ${days[focus.c].holiday} — always H` : days[focus.c].future ? "Upcoming day" : focusCell.source === "MANUAL" ? "Marked by you" : "Default (Present)") : undefined}
              statuses={selectableStatuses(data.statuses).filter((s) => !(selectedCount === 1 && days[focus.c].future) || s.plannable)}
              current={selectedCount === 1 ? focusCell.status : null}
              remarks={selectedCount === 1 ? focusCell.remarks : undefined}
              disabled={selectedCount === 1 && (focusCell.def === "NA" || days[focus.c].kind === "holiday")}
              askReason={popover.askReason}
              onPick={(code, reason) => { applyToSelection({ status: code, remarks: reason ?? null }); setPopover(null); gridRef.current?.focus(); }}
              onReset={() => { applyToSelection({ reset: true }); setPopover(null); gridRef.current?.focus(); }}
            />
          )}
          {popover.kind === "column" && (
            <CellPanel
              title={`Mark all employees · ${formatDate(days[popover.c].date, "long")}`}
              subtitle={days[popover.c].holiday ? `Holiday: ${days[popover.c].holiday}` : "Applies to everyone shown (NA days skipped)"}
              statuses={selectableStatuses(data.statuses).filter((s) => !days[popover.c].future || s.plannable)}
              current={null}
              onPick={async (code, reason) => {
                const c = popover.c;
                setPopover(null);
                if (!(await confirm({ title: "Mark entire day?", body: `Set ${code} for all ${rows.length} employees on ${formatDate(days[c].date)}?`, confirmLabel: "Apply" }))) return;
                const n = applyOps(rows.map((_, r) => ({ r, c, status: code, remarks: reason ?? null })));
                if (n) toast.success(`Updated ${n} cell(s)`);
              }}
              onReset={async () => {
                const c = popover.c;
                setPopover(null);
                if (!(await confirm({ title: "Reset day?", body: "Restore automatic values for everyone on this date? Remarks are cleared.", danger: true, confirmLabel: "Reset" }))) return;
                applyOps(rows.map((_, r) => ({ r, c, reset: true })));
              }}
            />
          )}
          {popover.kind === "row" && (
            <CellPanel
              title={`Mark entire month · ${rows[popover.r].name}`}
              subtitle="Future days accept planned leave only"
              statuses={selectableStatuses(data.statuses)}
              current={null}
              onPick={async (code, reason) => {
                const r = popover.r;
                setPopover(null);
                if (!(await confirm({ title: "Mark entire month?", body: `Set ${code} for every day of ${MONTHS[month - 1]} for ${rows[r].name}?`, confirmLabel: "Apply" }))) return;
                applyOps(days.map((_, c) => ({ r, c, status: code, remarks: reason ?? null })));
              }}
              onReset={async () => {
                const r = popover.r;
                setPopover(null);
                if (!(await confirm({ title: "Reset row to defaults?", body: `All of ${rows[r].name}'s edits this month will revert to automatic values (P / WO / H). Remarks are cleared.`, danger: true, confirmLabel: "Reset row" }))) return;
                applyOps(days.map((_, c) => ({ r, c, reset: true })));
              }}
            />
          )}
        </FloatingPanel>
      )}
    </div>
  );
}

function GridCellView({ r, c, cell, day, def, selected, focused, onMouseDown, onMouseEnter }: {
  r: number; c: number; cell: GridCell; day: GridDay; def?: StatusDef; selected: boolean; focused: boolean;
  onMouseDown: (e: React.MouseEvent) => void; onMouseEnter: () => void;
}) {
  const na = cell.def === "NA";
  const upcoming = day.future && cell.source === "NONE";
  return (
    <td data-cell={`${r}-${c}`} onMouseDown={onMouseDown} onMouseEnter={onMouseEnter}
      className={cn("relative cursor-cell select-none border-b p-0.5 text-center", day.today && "bg-accent-soft/50", day.kind !== "working" && !day.today && "bg-subtle/60")}>
      <div className={cn(
        "chip relative mx-auto flex h-7 w-[32px] items-center justify-center rounded-md text-[11px] font-semibold transition-[outline]",
        selected && "outline-2 outline-accent",
        focused && "outline-[3px] outline-accent",
      )}
        style={na || upcoming ? undefined : { background: def?.bg, color: def?.fg }}
        title={cell.remarks ?? undefined}>
        {na ? <span className="text-muted/50">–</span> : upcoming ? <span className="text-muted/40">·</span> : cell.status}
        {cell.source === "MANUAL" && <span className="absolute bottom-0 left-0 h-0 w-0 rounded-bl-md border-l-[6px] border-t-[6px] border-l-accent border-t-transparent" />}
        {cell.remarks && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </div>
    </td>
  );
}

function FloatingPanel({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: y + h > window.innerHeight - 8 ? Math.max(8, y - h - 48) : y });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => window.addEventListener("mousedown", down), 0);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", down); };
  }, [onClose]);
  return <div ref={ref} className="fixed z-50 w-[300px] rounded-2xl border bg-card p-3 shadow-2xl" style={pos}>{children}</div>;
}

function ReasonForm({ initial, onSubmit, onBack }: { initial?: string | null; onSubmit: (reason: string) => void; onBack: () => void }) {
  const [reason, setReason] = useState(initial ?? "");
  const ok = reason.trim().length >= 2;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(reason.trim()); }}>
      <p className="text-sm font-medium">Reason for absence</p>
      <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
        placeholder="e.g. Fever, family function, no information"
        className="min-h-16 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ok) onSubmit(reason.trim()); } }} />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>Back</Button>
        <Button type="submit" size="sm" variant="danger" className="flex-1" disabled={!ok}>Mark Absent (AB)</Button>
      </div>
    </form>
  );
}

function CellPanel({ title, subtitle, statuses, current, remarks, disabled, askReason, onPick, onReset, onRemarks }: {
  title: string; subtitle?: string; statuses: StatusDef[]; current: string | null; remarks?: string | null; disabled?: boolean; askReason?: boolean;
  onPick: (code: string, reason?: string) => void; onReset: () => void; onRemarks?: (text: string) => void;
}) {
  const [text, setText] = useState(remarks ?? "");
  const [asking, setAsking] = useState(Boolean(askReason));
  if (asking && !disabled) return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{title}</p>
      <ReasonForm initial={current === ABSENT_CODE ? remarks : ""} onSubmit={(r) => onPick(ABSENT_CODE, r)} onBack={() => setAsking(false)} />
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium leading-tight">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {!disabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {statuses.map((s) => (
              <button key={s.code} onClick={() => (s.code === ABSENT_CODE ? setAsking(true) : onPick(s.code))} title={`${s.label}${s.shortcut ? ` (${s.shortcut})` : ""}`}
                className={cn("chip flex h-12 flex-col items-center justify-center rounded-xl font-semibold transition hover:scale-[1.03]", current === s.code && "ring-2 ring-accent ring-offset-1 ring-offset-card")}
                style={{ background: s.bg, color: s.fg }}>
                <span className="text-sm">{s.code}</span>
                <span className="text-[10px] font-normal opacity-80">{s.label}</span>
              </button>
            ))}
          </div>
          {current === ABSENT_CODE && remarks && <p className="rounded-xl bg-subtle px-3 py-2 text-xs"><span className="text-muted">Reason:</span> {remarks}</p>}
          <Button variant="outline" size="sm" className="w-full" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" />Reset to default</Button>
          {onRemarks && remarks !== undefined && (
            <div className="space-y-1.5 border-t pt-3">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Remark (e.g. Doctor appointment)" className="min-h-14 text-xs" maxLength={500} />
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1" onClick={() => onRemarks(text.trim())}>Save remark</Button>
                {remarks && <Button size="sm" variant="ghost" onClick={() => onRemarks("")}><X className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BulkBar({ count, days, statuses, onApply, onClear }: {
  count: number; days: GridDay[]; statuses: StatusDef[]; onApply: (from: number, to: number, status: string) => void; onClear: () => void;
}) {
  const todayIdx = Math.max(0, days.findIndex((d) => d.today));
  const [from, setFrom] = useState(todayIdx);
  const [to, setTo] = useState(todayIdx);
  const [status, setStatus] = useState(statuses[0]?.code ?? "P");
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm">
      <span className="font-medium text-accent-fg">{count} selected</span>
      <span className="text-muted">Apply</span>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
        {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
        <option value="__reset">Reset to default</option>
      </Select>
      <span className="text-muted">from</span>
      <Select value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (v > to) setTo(v); }} className="h-8 w-24">
        {days.map((d, i) => <option key={d.date} value={i}>{d.day} {WEEKDAYS_SHORT[d.weekday]}</option>)}
      </Select>
      <span className="text-muted">to</span>
      <Select value={to} onChange={(e) => setTo(Number(e.target.value))} className="h-8 w-24">
        {days.map((d, i) => i >= from && <option key={d.date} value={i}>{d.day} {WEEKDAYS_SHORT[d.weekday]}</option>)}
      </Select>
      <Button size="sm" onClick={() => onApply(from, to, status)}><Check className="h-3.5 w-3.5" />Apply</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

const AVATAR_COLORS = ["#7C5CFC", "#F97316", "#10B981", "#0EA5E9", "#EC4899", "#F59E0B", "#6366F1", "#14B8A6", "#EF4444", "#8B5CF6"];

function Avatar({ name, index }: { name: string; index: number }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, ${color}c0)` }}>
      {initials}
    </div>
  );
}

const isPresent = (defs: Map<string, StatusDef>, code: string) => defs.get(code)?.bucket === "present";

function StatsRow({ rows, days, defs }: { rows: GridRow[]; days: GridDay[]; defs: Map<string, StatusDef> }) {
  const ti = days.findIndex((d) => d.today);
  let presentToday = 0, absentToday = 0, present = 0, absent = 0;
  rows.forEach((r) => r.cells.forEach((c, i) => {
    if (days[i].future || c.def === "NA" || days[i].kind === "weeklyOff") return;
    const p = isPresent(defs, c.status);
    const a = c.status === ABSENT_CODE;
    if (p) present++;
    if (a) absent++;
    if (i === ti) { if (p) presentToday++; if (a) absentToday++; }
  }));
  const pct = present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : null;
  const items = [
    { label: "Employees", value: rows.length, icon: <Users className="h-4 w-4" />, tile: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300" },
    { label: "Present today", value: ti >= 0 ? presentToday : "—", icon: <UserCheck className="h-4 w-4" />, tile: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300" },
    { label: "Absent today", value: ti >= 0 ? absentToday : "—", icon: <UserX className="h-4 w-4" />, tile: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300" },
    { label: "Attendance this month", value: pct === null ? "—" : `${pct}%`, icon: <TrendingUp className="h-4 w-4" />, tile: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300", bar: pct },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it, i) => (
        <div key={it.label} style={{ animationDelay: `${i * 60}ms` }}
          className="animate-fade-up rounded-2xl border bg-card p-5 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">{it.label}</p>
            <div className={cn("rounded-xl p-2", it.tile)}>{it.icon}</div>
          </div>
          <p className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-tight">{it.value}</p>
          {it.bar !== undefined && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-[width] duration-700" style={{ width: `${it.bar ?? 0}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DayMarker({ rows, days, defs, canEdit, onSet }: {
  rows: GridRow[]; days: GridDay[]; defs: Map<string, StatusDef>; canEdit: boolean; onSet: (r: number, c: number, status: string, reason?: string) => void;
}) {
  const todayIdx = days.findIndex((d) => d.today);
  const [c, setC] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [asking, setAsking] = useState<number | null>(null);
  const idx = Math.min(c, days.length - 1);
  const day = days[idx];
  if (!day) return null;
  const off = day.kind === "weeklyOff";
  const holiday = day.kind === "holiday";
  let p = 0, a = 0;
  rows.forEach((r) => {
    const cell = r.cells[idx];
    if (cell.def === "NA") return;
    if (isPresent(defs, cell.status)) p++;
    if (cell.status === ABSENT_CODE) a++;
  });
  const go = (i: number) => { setAsking(null); setC(Math.max(0, Math.min(days.length - 1, i))); };

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-gradient-to-r from-accent-soft/70 via-card to-card px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold">Mark attendance</h2>
          <p className="text-sm text-muted">
            {formatDate(day.date, "long")}
            {day.today && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-fg">Today</span>}
            {day.future && <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium">Upcoming</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!off && (
            <div className="hidden items-center gap-2 text-xs font-medium sm:flex">
              <span key={`p${p}`} className="animate-pop rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{p} Present</span>
              <span key={`a${a}`} className="animate-pop rounded-full bg-rose-50 px-2.5 py-1 text-rose-700 dark:bg-rose-950 dark:text-rose-300">{a} Absent</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => go(idx - 1)} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
            <Select value={idx} onChange={(e) => go(Number(e.target.value))} className="h-8 w-36 border-0 bg-transparent text-sm font-medium focus:ring-0" aria-label="Day">
              {days.map((d, i) => <option key={d.date} value={i}>{d.day} {MONTHS[parseISO(d.date).month - 1].slice(0, 3)}, {WEEKDAYS_SHORT[d.weekday]}</option>)}
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => go(idx + 1)} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
            {todayIdx >= 0 && idx !== todayIdx && <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => go(todayIdx)}>Today</Button>}
          </div>
        </div>
      </div>

      {holiday && (
        <div className="flex animate-slide-down items-center gap-2 border-b bg-orange-50/80 px-5 py-2.5 text-sm text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
          <PartyPopper className="h-4 w-4" /> <span><b>{day.holiday}</b> — public holiday. Everyone is marked <b>H</b> and counted as present.</span>
        </div>
      )}
      {off && <div className="animate-slide-down border-b bg-subtle/60 px-5 py-2.5 text-sm text-muted">Sunday — weekly off. Nothing to mark.</div>}

      <div key={day.date} className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, r) => {
          const cell = row.cells[idx];
          const na = cell.def === "NA";
          const present = !na && cell.status === "P";
          const absent = cell.status === ABSENT_CODE;
          const disabled = !canEdit || off || holiday || na;
          return (
            <div key={row.id} style={{ animationDelay: `${Math.min(r, 20) * 25}ms` }}
              className={cn("animate-fade-up rounded-2xl border p-3 transition duration-300",
                absent ? "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30"
                  : holiday ? "border-orange-100 bg-orange-50/40 dark:border-orange-950 dark:bg-orange-950/20"
                    : "bg-card hover:-translate-y-0.5 hover:shadow-md")}>
              <div className="flex items-center gap-3">
                <Avatar name={row.name} index={r} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted">
                    {row.empCode}
                    {absent && <span className="text-rose-600 dark:text-rose-400"> · {cell.remarks || "No reason"}</span>}
                    {na && " · joins later"}
                  </p>
                </div>
                {holiday && !na ? (
                  <span className="rounded-full bg-orange-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-orange-500/30">H</span>
                ) : (
                  <div className={cn("flex shrink-0 rounded-full bg-subtle p-1", disabled && "opacity-50")}>
                    <button disabled={disabled} title="Present" onClick={() => { setAsking(null); if (cell.status !== "P") onSet(r, idx, "P"); }}
                      className={cn("h-9 min-w-12 rounded-full px-3 text-sm font-semibold transition-all duration-200 active:scale-90 disabled:cursor-not-allowed",
                        present ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30" : "text-muted hover:bg-card hover:text-fg")}>
                      <span key={present ? "on" : "off"} className={cn("inline-block", present && "animate-pop")}>P</span>
                    </button>
                    <button disabled={disabled} title="Absent" onClick={() => setAsking(asking === r ? null : r)}
                      className={cn("h-9 min-w-12 rounded-full px-3 text-sm font-semibold transition-all duration-200 active:scale-90 disabled:cursor-not-allowed",
                        absent ? "bg-rose-500 text-white shadow-md shadow-rose-500/30" : "text-muted hover:bg-card hover:text-fg")}>
                      <span key={absent ? "on" : "off"} className={cn("inline-block", absent && "animate-pop")}>AB</span>
                    </button>
                  </div>
                )}
              </div>
              {asking === r && (
                <div className="mt-3 animate-slide-down border-t pt-3">
                  <ReasonForm initial={absent ? cell.remarks : ""} onBack={() => setAsking(null)}
                    onSubmit={(reason) => { onSet(r, idx, ABSENT_CODE, reason); setAsking(null); }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AddEmployeeDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [doj, setDoj] = useState(todayIST());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter the employee's name");
    setBusy(true);
    setError(null);
    try {
      const emp = await api<{ empCode: string; name: string }>("/api/employees", { body: { name: name.trim(), dateOfJoining: doj } });
      toast.success(`${emp.name} added as ${emp.empCode}`);
      setName("");
      setDoj(todayIST());
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Add employee">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi Kumar" autoFocus /></Field>
        <Field label="Joining date" hint="Attendance can be marked from this date onwards." error={error ?? undefined}>
          <Input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}><UserPlus className="h-4 w-4" />Add employee</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SaveIndicator({ pending, state }: { pending: number; state: "idle" | "saved" | "error" }) {
  if (pending > 0) return <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>;
  if (state === "saved") return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />Saved</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1.5 text-xs text-danger"><AlertCircle className="h-3.5 w-3.5" />Not saved</span>;
  return null;
}

function ExportMenu({ year, month, department }: { year: number; month: number; department: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (format: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await download(`/api/reports/register?year=${year}&month=${month}&format=${format}${department ? `&department=${encodeURIComponent(department)}` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} loading={busy}><Download className="h-3.5 w-3.5" />Export</Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-44 rounded-2xl border bg-card p-1 shadow-xl">
          {(LOCAL_MODE ? [["csv", "Excel / CSV"]] : [["xlsx", "Excel (.xlsx)"], ["pdf", "PDF (A4)"], ["csv", "CSV"]]).map(([f, l]) => (
            <button key={f} onClick={() => run(f)} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-subtle">{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <Card className="space-y-2 p-4">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </Card>
  );
}
