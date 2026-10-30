"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Download, Info, Loader2, Lock, MoreHorizontal, Pencil, Redo2, RotateCcw, Search, Undo2, X, AlertCircle, PartyPopper, TrendingUp, UserPlus, Users, UserCheck, UserX,
} from "lucide-react";
import { Button, Card, Dialog, EmptyState, Field, Input, Select, Skeleton, StatusChip, Textarea, addRipple } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { LOCAL_MODE, api, download } from "@/lib/client";
import { cn, fmtNum } from "@/lib/utils";
import { MONTHS, WEEKDAYS_SHORT, formatDate, parseISO, todayIST } from "@/lib/dates";
import { ABSENT_CODE, HALF_DAY_CODE, REASON_CODES, selectableStatuses, statusMap, type StatusDef } from "@/lib/status";
import { summarize } from "@/lib/payroll";
import type { GridCell, GridDay, GridRow, MonthGrid } from "@/lib/attendance";
import type { Role } from "@/lib/permissions";

type GridData = MonthGrid & { canEdit: boolean; role: Role };
type Pos = { r: number; c: number };
type Op = { r: number; c: number; status?: string; reset?: boolean; remarks?: string | null };
type HistoryCell = { employeeId: string; date: string; before: GridCell; after: GridCell };
type Popover =
  | { kind: "cell"; x: number; y: number; yTop: number; askReason?: string }
  | { kind: "column"; c: number; x: number; y: number; yTop: number }
  | { kind: "row"; r: number; x: number; y: number; yTop: number };

const ROW_H = 38;
const DAY_W = 36;
const CHECK_W = 0;
const CODE_W = 70;
const NAME_W = 172;
const LEFT_W = CHECK_W + CODE_W + NAME_W;
const SUM_W = 60;
const SUMMARY = [{ key: "present", label: "Present" }, { key: "halfDay", label: "Half" }, { key: "absent", label: "Absent" }] as const;

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
  const [editing, setEditing] = useState<GridRow | null>(null);
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
  const pendingRef = useRef(0);
  pendingRef.current = pending;
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

  // Show changes made on other devices.
  useEffect(() => {
    const on = () => { if (pendingRef.current === 0) void load(); };
    window.addEventListener("tivor-data-changed", on);
    return () => window.removeEventListener("tivor-data-changed", on);
  }, [load]);

  // Keep "today" correct: if the date rolls over while the page is open, reload.
  useEffect(() => {
    const t = setInterval(() => { if (data && todayIST() !== data.today) void load(); }, 30_000);
    return () => clearInterval(t);
  }, [data, load]);

  const removeEmployee = useCallback(async (row: GridRow) => {
    if (!(await confirm({ title: `Remove ${row.name}?`, body: `${row.name} (${row.empCode}) and all of their attendance records will be deleted. This cannot be undone.`, danger: true, confirmLabel: "Remove employee" }))) return;
    try {
      await api(`/api/employees/${row.id}`, { method: "DELETE" });
      toast.success(`${row.name} removed`);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [confirm, load]);

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
  const openCellPopover = useCallback((p: Pos, askReason?: string) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${p.r}-${p.c}"]`);
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    setPopover({ kind: "cell", x: rect.left - 4, y: rect.bottom + 6, yTop: rect.top - 6, askReason });
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
    if (REASON_CODES.includes(code)) return openCellPopover(focus, code); // AB / HD always need a reason
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
  const anchorOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6, yTop: r.top - 6 };
  };

  const header = (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 items-center rounded-lg border border-border-strong bg-card shadow-soft">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="flex h-full w-8 items-center justify-center rounded-l-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronLeft className="h-4 w-4" /></button>
          <Select aria-label="Month" value={month} onChange={(e) => goMonth(year, Number(e.target.value))} className="h-full w-[118px] rounded-none border-0 border-x bg-transparent text-[13px] font-medium shadow-none focus:ring-0">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
          <Select aria-label="Year" value={year} onChange={(e) => goMonth(Number(e.target.value), month)} className="h-full w-[92px] rounded-none border-0 border-r bg-transparent pr-7 text-[13px] font-medium shadow-none focus:ring-0">
            {Array.from({ length: 9 }, (_, i) => now.year - 5 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="flex h-full w-8 items-center justify-center rounded-r-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {(year !== now.year || month !== now.month) && <Button variant="outline" size="sm" className="h-9 animate-scale-in" onClick={() => goMonth(now.year, now.month)}><CalendarDays className="h-3.5 w-3.5" />This month</Button>}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 pl-9 text-[13px]" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <SaveIndicator pending={pending} state={saveState} />
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
          <ExportMenu year={year} month={month} department={department} />
          <Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" />Add employee</Button>
        </div>
      </div>
      {data?.lock && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm"><Lock className="h-4 w-4" /> This month is locked and read-only.</div>
      )}
      {data && !data.canEdit && !data.lock && (
        <div className="flex items-center gap-2 rounded-lg bg-subtle px-4 py-2.5 text-sm text-muted"><Info className="h-4 w-4" /> Read-only access.</div>
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
          <StatsRow key={data.today} rows={rows} days={days} defs={defs} />
          <DayMarker key={`${data.today}-${year}-${month}`} rows={rows} days={days} defs={defs} canEdit={data.canEdit}
            onRemove={removeEmployee} onEdit={(row) => setEditing(row)}
            onSet={(r, c, status, reason) => applyOps([status === "__reset" ? { r, c, reset: true } : { r, c, status, remarks: reason ?? null }])} />

          {/* Monthly register (desktop / tablet) */}
          <div className="mb-3 mt-8 hidden items-end justify-between md:flex">
            <div>
              <h2 className="text-base font-semibold">Monthly register</h2>
              <p className="mt-0.5 text-[13px] text-muted">Click a cell to change it · drag to select several · keys <kbd className="rounded border bg-card px-1 font-mono text-[11px]">P</kbd> <kbd className="rounded border bg-card px-1 font-mono text-[11px]">H</kbd> <kbd className="rounded border bg-card px-1 font-mono text-[11px]">A</kbd></p>
            </div>
          </div>
          <Card className="hidden animate-fade-up overflow-hidden md:block">
            <div ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} className="outline-none" aria-label="Attendance grid. Use arrow keys to move and letter shortcuts to set status.">
              <div ref={scrollRef} className="scrollbar-thin relative max-h-[calc(100vh-200px)] min-h-[300px] overflow-auto">
                <table className="border-separate border-spacing-0 text-xs" style={{ width: LEFT_W + days.length * DAY_W + SUMMARY.length * SUM_W }}>
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-30 border-b bg-subtle px-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted" style={{ left: CHECK_W, width: CODE_W, minWidth: CODE_W }}>ID</th>
                      <th className="sticky top-0 z-30 border-b border-r bg-subtle px-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted" style={{ left: CHECK_W + CODE_W, width: NAME_W, minWidth: NAME_W }}>Employee</th>
                      {days.map((d, c) => (
                        <th key={d.date} style={{ width: DAY_W, minWidth: DAY_W }}
                          title={d.holiday ? `Holiday: ${d.holiday}` : d.kind === "weeklyOff" ? "Weekly off" : `Mark everyone on ${formatDate(d.date)}`}
                          onClick={(e) => { if (!data.canEdit) return; setPopover({ kind: "column", c, ...anchorOf(e.currentTarget as HTMLElement) }); }}
                          className={cn("sticky top-0 z-20 cursor-pointer select-none border-b py-1.5 text-center transition-colors hover:bg-border/60",
                            d.kind === "weeklyOff" ? "bg-subtle text-muted" : d.kind === "holiday" ? "bg-subtle text-[var(--st-h-fg)]" : "bg-subtle text-fg-2",
                            d.future && !d.today && "opacity-60")}>
                          <div className={cn("mx-auto flex h-7 w-7 flex-col items-center justify-center rounded-md", d.today && "bg-primary text-primary-fg shadow-sm")}>
                            <span className="text-[12px] font-semibold leading-none">{d.day}</span>
                            <span className="mt-0.5 text-[8px] font-medium uppercase leading-none opacity-70">{WEEKDAYS_SHORT[d.weekday].slice(0, 2)}</span>
                          </div>
                        </th>
                      ))}
                      {SUMMARY.map((s, i) => (
                        <th key={s.key} className={cn("sticky top-0 z-30 border-b bg-subtle px-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted xl:right-[var(--r)]", i === 0 && "border-l")}
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
                          <td className="sticky z-10 border-b bg-card px-3 font-mono text-[11px] text-muted transition-colors group-hover:bg-subtle" style={{ left: CHECK_W }}>{row.empCode}</td>
                          <td className="sticky z-10 border-b border-r bg-card px-3 transition-colors group-hover:bg-subtle" style={{ left: CHECK_W + CODE_W }}>
                            <div className="flex items-center gap-1">
                              <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{row.name}</div>
                              {data.canEdit && (
                                <button aria-label={`Row actions for ${row.name}`} className="rounded-md p-1 text-muted opacity-0 transition hover:bg-border group-hover:opacity-100 focus:opacity-100"
                                  onClick={(e) => setPopover({ kind: "row", r, ...anchorOf(e.currentTarget) })}>
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
                            <td key={sm.key} className={cn("z-10 border-b bg-card text-center text-[13px] tabular-nums transition-colors group-hover:bg-subtle xl:sticky xl:right-[var(--r)]", i === 0 && "border-l",
                              sm.key === "absent" && s.absent > 0 && "font-semibold text-[var(--st-ab-fg)]", sm.key === "halfDay" && s.halfDay > 0 && "font-semibold text-[var(--st-hd-fg)]")}
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-subtle/50 px-4 py-2.5 text-xs text-muted">
              {["P", "HD", "AB", "H", "WO"].map((code) => (
                <span key={code} className="inline-flex items-center gap-1.5"><StatusChip code={code} />{defs.get(code)?.label}</span>
              ))}
              <span className="ml-auto inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-fg-2" /> Has reason (hover)</span>
                <span className="inline-flex items-center gap-1.5"><span className="rounded border px-1 text-[10px] font-semibold">₹</span> Exam — paid, no LOP</span>
              </span>
            </div>
          </Card>
        </>
      )}

      <AddEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void load(); }} />
      <EditEmployeeDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />

      {popover && (
        <FloatingPanel x={popover.x} y={popover.y} yTop={popover.yTop} onClose={() => setPopover(null)}>
          {popover.kind === "cell" && focus && focusCell && (
            <CellPanel
              title={selectedCount > 1 ? `${selectedCount} cells selected` : rows[focus.r].name}
              subtitle={selectedCount === 1 ? `${formatDate(days[focus.c].date, "long")} · ${focusCell.def === "NA" ? "not employed" : days[focus.c].kind === "holiday" ? `${days[focus.c].holiday} (holiday)` : days[focus.c].future ? "upcoming" : focusCell.source === "MANUAL" ? "marked" : "default"}` : "Choose a status for all selected cells"}
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
              title="Mark everyone"
              subtitle={`${formatDate(days[popover.c].date, "long")}${days[popover.c].holiday ? ` · ${days[popover.c].holiday}` : ""}`}
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
                if (!(await confirm({ title: "Reset day?", body: "Everyone goes back to the default for this date. Reasons are cleared.", danger: true, confirmLabel: "Reset" }))) return;
                applyOps(rows.map((_, r) => ({ r, c, reset: true })));
              }}
            />
          )}
          {popover.kind === "row" && (
            <CellPanel
              title={rows[popover.r].name}
              subtitle={`Mark every day of ${MONTHS[month - 1]}`}
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
                if (!(await confirm({ title: "Reset row?", body: `All of ${rows[r].name}'s marks this month go back to the default. Reasons are cleared.`, danger: true, confirmLabel: "Reset row" }))) return;
                applyOps(days.map((_, c) => ({ r, c, reset: true })));
              }}
            />
          )}
        </FloatingPanel>
      )}
    </div>
  );
}

const isExam = (reason: string | null | undefined) => !!reason && /\bexam/i.test(reason);

function GridCellView({ r, c, cell, day, selected, focused, onMouseDown, onMouseEnter }: {
  r: number; c: number; cell: GridCell; day: GridDay; def?: StatusDef; selected: boolean; focused: boolean;
  onMouseDown: (e: React.MouseEvent) => void; onMouseEnter: () => void;
}) {
  const na = cell.def === "NA";
  const upcoming = day.future && cell.source === "NONE";
  const exam = cell.status === ABSENT_CODE && isExam(cell.remarks);
  return (
    <td data-cell={`${r}-${c}`} onMouseDown={onMouseDown} onMouseEnter={onMouseEnter}
      className={cn("relative cursor-pointer select-none border-b p-0.5 text-center transition-colors group-hover:bg-subtle/70", day.kind === "weeklyOff" && "bg-subtle/50", day.today && "bg-subtle")}>
      <div
        className={cn(
          "relative mx-auto flex h-6 w-[30px] items-center justify-center rounded-md text-[10.5px] font-semibold transition-all duration-150 hover:scale-110",
          !na && !upcoming && `st st-${cell.status}`,
          (na || upcoming) && "text-muted/50",
          selected && "ring-2 ring-fg/70 ring-offset-1 ring-offset-card",
          focused && "ring-2 ring-fg ring-offset-1 ring-offset-card",
        )}
        title={cell.remarks ? `${cell.status}: ${cell.remarks}${exam ? " (paid)" : ""}` : undefined}>
        <span key={cell.status} className={cn("inline-block", cell.source === "MANUAL" && "animate-pop")}>
          {na ? "–" : upcoming ? "·" : cell.status}
        </span>
        {cell.remarks && <span className={cn("absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-card", exam ? "bg-[var(--st-p-fg)]" : "bg-fg-2")} />}
      </div>
    </td>
  );
}

/** Popover rendered into <body> next to its anchor: below if there is room, otherwise above. */
function FloatingPanel({ x, y, yTop, onClose, children }: { x: number; y: number; yTop: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = y + h <= window.innerHeight - 8;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      top: below ? y : Math.max(8, yTop - h),
      origin: below ? "top left" : "bottom left",
    });
  }, [x, y, yTop]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    const t = setTimeout(() => { window.addEventListener("mousedown", down); window.addEventListener("scroll", close, true); }, 0);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", down); window.removeEventListener("scroll", close, true); };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={cn("fixed z-50 w-[288px] rounded-xl border bg-raised p-3 shadow-pop", pos ? "animate-scale-in" : "invisible")}
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { left: x, top: y }}>
      {children}
    </div>,
    document.body,
  );
}

const QUICK_REASONS = ["Exam", "Sick", "Personal", "Family function", "Not informed"];

function ReasonForm({ code, initial, onSubmit, onBack }: { code: string; initial?: string | null; onSubmit: (reason: string) => void; onBack: () => void }) {
  const [reason, setReason] = useState(initial ?? "");
  const ok = reason.trim().length >= 2;
  const half = code === HALF_DAY_CODE;
  return (
    <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(reason.trim()); }}>
      <div className="flex items-center gap-2">
        <span className={cn("st rounded-md px-1.5 py-0.5 text-[11px] font-semibold", `st-${code}`)}>{code}</span>
        <p className="text-[13px] font-medium">{half ? "Reason for half day" : "Reason for absence"}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_REASONS.map((q, i) => (
          <button type="button" key={q} onClick={() => setReason(q)} style={{ animationDelay: `${i * 30}ms` }}
            className={cn("animate-fade-up rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:border-fg/40 active:scale-95",
              reason === q ? "border-fg bg-primary text-primary-fg" : "bg-card text-fg-2")}>{q}</button>
        ))}
      </div>
      <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
        placeholder={half ? "e.g. Left early for an appointment" : "Type a reason…"}
        className="min-h-14 text-[13px]"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ok) onSubmit(reason.trim()); } }} />
      {isExam(reason) && !half && <p className="animate-slide-down text-[11px] text-[var(--st-p-fg)]">Exam absences are paid — no loss of pay.</p>}
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>Cancel</Button>
        <Button type="submit" size="sm" className="flex-1" disabled={!ok}>Save {code}</Button>
      </div>
    </form>
  );
}

function CellPanel({ title, subtitle, statuses, current, remarks, disabled, askReason, onPick, onReset }: {
  title: string; subtitle?: string; statuses: StatusDef[]; current: string | null; remarks?: string | null; disabled?: boolean; askReason?: string;
  onPick: (code: string, reason?: string) => void; onReset: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(askReason ?? null);
  if (asking && !disabled) return (
    <div key="ask" className="animate-fade-in">
      <p className="mb-2 truncate text-xs text-muted">{title}</p>
      <ReasonForm code={asking} initial={current === asking ? remarks : ""} onSubmit={(r) => onPick(asking, r)} onBack={() => setAsking(null)} />
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="truncate text-[13px] font-semibold leading-tight">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {disabled ? <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">This day can&apos;t be changed.</p> : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {statuses.map((s, i) => (
              <button key={s.code} style={{ animationDelay: `${i * 35}ms` }} onClick={(e) => { addRipple(e); if (REASON_CODES.includes(s.code)) setAsking(s.code); else onPick(s.code); }}
                title={`${s.label}${s.shortcut ? ` (${s.shortcut})` : ""}`}
                className={cn("relative flex h-12 animate-fade-up flex-col items-center justify-center overflow-hidden rounded-lg border transition duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-95",
                  current === s.code ? `st st-${s.code} border-transparent` : "bg-card hover:border-border-strong")}>
                <span className="text-[13px] font-semibold">{s.code}</span>
                <span className="text-[10px] text-muted">{s.label}</span>
              </button>
            ))}
          </div>
          {current && REASON_CODES.includes(current) && remarks && (
            <p className="rounded-lg bg-subtle px-2.5 py-1.5 text-xs"><span className="text-muted">Reason · </span>{remarks}{isExam(remarks) && <span className="ml-1 text-[var(--st-p-fg)]">(paid)</span>}</p>
          )}
          <button onClick={onReset} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-muted transition hover:bg-subtle hover:text-fg">
            <RotateCcw className="h-3.5 w-3.5" />Reset to default
          </button>
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
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-subtle px-4 py-2.5 text-sm">
      <span className="font-medium">{count} selected</span>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
        {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
        <option value="__reset">Reset to default</option>
      </Select>
      <Select value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (v > to) setTo(v); }} className="h-8 w-24">
        {days.map((d, i) => <option key={d.date} value={i}>{d.day} {WEEKDAYS_SHORT[d.weekday]}</option>)}
      </Select>
      <Select value={to} onChange={(e) => setTo(Number(e.target.value))} className="h-8 w-24">
        {days.map((d, i) => i >= from && <option key={d.date} value={i}>{d.day} {WEEKDAYS_SHORT[d.weekday]}</option>)}
      </Select>
      <Button size="sm" onClick={() => onApply(from, to, status)}><Check className="h-3.5 w-3.5" />Apply</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-subtle text-xs font-semibold text-fg-2 transition-transform duration-300 group-hover/card:scale-105">
      {initials}
    </div>
  );
}

/** Animated number that eases from its previous value to the new one. */
function CountUp({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toFixed(decimals)}{suffix}</>;
}

const isPresent = (defs: Map<string, StatusDef>, code: string) => defs.get(code)?.bucket === "present";

function StatsRow({ rows, days, defs }: { rows: GridRow[]; days: GridDay[]; defs: Map<string, StatusDef> }) {
  const ti = days.findIndex((d) => d.today);
  let presentToday = 0, absentToday = 0, halfToday = 0, units = 0, worked = 0;
  rows.forEach((r) => r.cells.forEach((c, i) => {
    if (days[i].future || c.def === "NA" || days[i].kind === "weeklyOff") return;
    worked++;
    if (isPresent(defs, c.status)) units += 1;
    else if (c.status === HALF_DAY_CODE) units += 0.5;
    if (i === ti) {
      if (isPresent(defs, c.status)) presentToday++;
      else if (c.status === ABSENT_CODE) absentToday++;
      else if (c.status === HALF_DAY_CODE) halfToday++;
    }
  }));
  const pct = worked ? Math.round((units / worked) * 1000) / 10 : null;
  const [barReady, setBarReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBarReady(true), 150); return () => clearTimeout(t); }, []);
  const items = [
    { label: "Employees", value: rows.length, icon: <Users className="h-4 w-4" />, dot: null },
    { label: "Present today", value: ti >= 0 ? presentToday : null, icon: <UserCheck className="h-4 w-4" />, dot: "P" },
    { label: "Absent today", value: ti >= 0 ? absentToday : null, icon: <UserX className="h-4 w-4" />, dot: "AB", sub: ti >= 0 ? `${halfToday} on half day` : undefined },
    { label: "Attendance this month", value: pct, pct: true, icon: <TrendingUp className="h-4 w-4" />, dot: null },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it, i) => (
        <div key={it.label} style={{ animationDelay: `${i * 60}ms` }}
          className="group relative animate-fade-up overflow-hidden rounded-xl border bg-card p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              {it.dot && <span className={cn("h-1.5 w-1.5 rounded-full", `dot-${it.dot}`)} />}{it.label}
            </p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-subtle text-fg-2 transition duration-300 group-hover:rotate-6 group-hover:scale-110">{it.icon}</div>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {it.value === null ? "—" : <CountUp value={it.value} decimals={it.pct ? 1 : 0} suffix={it.pct ? "%" : ""} />}
          </p>
          {it.sub && <p className="mt-0.5 text-xs text-muted">{it.sub}</p>}
          {it.pct && (
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-[var(--st-p-fg)] transition-[width] duration-1000 ease-out" style={{ width: barReady ? `${pct ?? 0}%` : "0%" }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const STATUS_BUTTONS = [
  { code: "P", label: "Present" },
  { code: "HD", label: "Half day" },
  { code: "AB", label: "Absent" },
] as const;

function DayMarker({ rows, days, defs, canEdit, onSet, onRemove, onEdit }: {
  rows: GridRow[]; days: GridDay[]; defs: Map<string, StatusDef>; canEdit: boolean;
  onSet: (r: number, c: number, status: string, reason?: string) => void; onRemove: (row: GridRow) => void; onEdit: (row: GridRow) => void;
}) {
  const todayIdx = days.findIndex((d) => d.today);
  const [c, setC] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [asking, setAsking] = useState<{ r: number; code: string } | null>(null);
  const idx = Math.min(c, days.length - 1);
  const day = days[idx];
  if (!day) return null;
  const off = day.kind === "weeklyOff";
  const holiday = day.kind === "holiday";
  let p = 0, a = 0, h = 0;
  rows.forEach((r) => {
    const cell = r.cells[idx];
    if (cell.def === "NA") return;
    if (isPresent(defs, cell.status)) p++;
    else if (cell.status === ABSENT_CODE) a++;
    else if (cell.status === HALF_DAY_CODE) h++;
  });
  const go = (i: number) => { setAsking(null); setC(Math.max(0, Math.min(days.length - 1, i))); };

  return (
    <Card className="mt-5 animate-fade-up overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Mark attendance</h2>
            <p key={day.date} className="animate-fade-in text-[13px] text-muted">
              {formatDate(day.date, "long")}
              {day.today && <span className="ml-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-fg">Today</span>}
              {day.future && <span className="ml-2 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Upcoming</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!off && (
            <div className="hidden items-center gap-1.5 text-xs font-medium sm:flex">
              <span key={`p${p}`} className="st st-P animate-pop rounded-md px-2 py-0.5">{p} present</span>
              <span key={`h${h}`} className="st st-HD animate-pop rounded-md px-2 py-0.5">{h} half day</span>
              <span key={`a${a}`} className="st st-AB animate-pop rounded-md px-2 py-0.5">{a} absent</span>
            </div>
          )}
          <div className="flex h-8 items-center rounded-lg border border-border-strong bg-card shadow-soft">
            <button onClick={() => go(idx - 1)} aria-label="Previous day" className="flex h-full w-7 items-center justify-center rounded-l-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronLeft className="h-4 w-4" /></button>
            <Select value={idx} onChange={(e) => go(Number(e.target.value))} className="h-full w-[148px] rounded-none border-0 border-x bg-transparent pr-7 text-[13px] font-medium shadow-none focus:ring-0" aria-label="Day">
              {days.map((d, i) => <option key={d.date} value={i}>{WEEKDAYS_SHORT[d.weekday]}, {d.day} {MONTHS[parseISO(d.date).month - 1].slice(0, 3)}</option>)}
            </Select>
            <button onClick={() => go(idx + 1)} aria-label="Next day" className="flex h-full w-7 items-center justify-center rounded-r-lg text-muted transition hover:bg-subtle hover:text-fg active:scale-90"><ChevronRight className="h-4 w-4" /></button>
          </div>
          {todayIdx >= 0 && idx !== todayIdx && <Button variant="outline" size="sm" className="animate-scale-in" onClick={() => go(todayIdx)}>Today</Button>}
        </div>
      </div>

      {holiday && (
        <div className="flex animate-slide-down items-center gap-2 border-b bg-[var(--st-h-bg)] px-4 py-2 text-[13px] text-[var(--st-h-fg)]">
          <PartyPopper className="h-4 w-4" /> <span><b>{day.holiday}</b> — public holiday. Everyone is marked H and counted as present.</span>
        </div>
      )}
      {off && <div className="animate-slide-down border-b bg-subtle px-4 py-2 text-[13px] text-muted">Sunday — weekly off. Nothing to mark.</div>}

      <div key={day.date} className="grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, r) => {
          const cell = row.cells[idx];
          const na = cell.def === "NA";
          const disabled = !canEdit || off || holiday || na;
          const reasoned = REASON_CODES.includes(cell.status);
          return (
            <div key={row.id} style={{ animationDelay: `${Math.min(r, 20) * 25}ms` }}
              className={cn("group/card relative animate-fade-up rounded-lg border bg-card p-2.5 pl-3 transition duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop",
                (cell.status === ABSENT_CODE || cell.status === HALF_DAY_CODE) && "border-l-[3px]",
                cell.status === ABSENT_CODE && "border-l-[var(--st-ab-fg)]", cell.status === HALF_DAY_CODE && "border-l-[var(--st-hd-fg)]")}>
              <div className="flex items-center gap-2.5">
                <Avatar name={row.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{row.name}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="font-mono text-[11px]">{row.empCode}</span>
                    {reasoned && <span key={cell.remarks ?? ""} className="animate-fade-in text-fg-2"> · {cell.remarks || "No reason"}{isExam(cell.remarks) && <span className="text-[var(--st-p-fg)]"> · paid</span>}</span>}
                    {na && " · not joined yet"}
                  </p>
                </div>
                {holiday && !na ? (
                  <span className="st st-H rounded-md px-2.5 py-1 text-xs font-semibold">H</span>
                ) : (
                  <div className={cn("flex shrink-0 gap-0.5 rounded-lg border bg-subtle p-0.5", disabled && "opacity-40")}>
                    {STATUS_BUTTONS.map((b) => {
                      const active = cell.status === b.code && !na;
                      return (
                        <button key={b.code} disabled={disabled} title={b.label}
                          onClick={(e) => {
                            addRipple(e);
                            if (REASON_CODES.includes(b.code)) setAsking(asking?.r === r && asking.code === b.code ? null : { r, code: b.code });
                            else { setAsking(null); if (cell.status !== b.code) onSet(r, idx, b.code); }
                          }}
                          className={cn("relative h-7 min-w-9 overflow-hidden rounded-md px-2 text-xs font-semibold transition-all duration-200 active:scale-90 disabled:cursor-not-allowed",
                            active ? `st st-${b.code} shadow-sm` : "text-muted hover:bg-card hover:text-fg")}>
                          <span key={active ? "on" : "off"} className={cn("relative inline-block", active && "animate-pop")}>{b.code}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="absolute -right-2 -top-2 flex scale-75 gap-1 opacity-0 transition duration-200 group-hover/card:scale-100 group-hover/card:opacity-100">
                  <button onClick={() => onEdit(row)} title={`Edit ${row.name}`} aria-label={`Edit ${row.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full border bg-raised text-muted shadow-sm transition hover:bg-primary hover:text-primary-fg focus:opacity-100"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => onRemove(row)} title={`Remove ${row.name}`} aria-label={`Remove ${row.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full border bg-raised text-muted shadow-sm transition hover:bg-danger hover:text-white focus:opacity-100"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {asking?.r === r && (
                <div className="mt-2.5 animate-slide-down border-t pt-2.5">
                  <ReasonForm code={asking.code} initial={cell.status === asking.code ? cell.remarks : ""} onBack={() => setAsking(null)}
                    onSubmit={(reason) => { onSet(r, idx, asking.code, reason); setAsking(null); }} />
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
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}><UserPlus className="h-4 w-4" />Add employee</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditEmployeeDialog({ row, onClose, onSaved }: { row: GridRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [doj, setDoj] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!row) return;
    setName(row.name);
    setError(null);
    api<{ dateOfJoining: string }>(`/api/employees/${row.id}`).then((e) => setDoj(e.dateOfJoining)).catch(() => setDoj(""));
  }, [row]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/employees/${row.id}`, { method: "PUT", body: { name: name.trim(), dateOfJoining: doj } });
      toast.success("Employee updated");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!row} onClose={onClose} title={`Edit ${row?.empCode ?? ""}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Joining date" hint="Days before this date are not counted." error={error ?? undefined}>
          <Input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save changes</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SaveIndicator({ pending, state }: { pending: number; state: "idle" | "saved" | "error" }) {
  if (pending > 0) return <span className="inline-flex animate-fade-in items-center gap-1.5 px-1 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>;
  if (state === "saved") return <span key={Date.now()} className="inline-flex animate-fade-in items-center gap-1.5 px-1 text-xs text-[var(--st-p-fg)]"><Check className="h-3.5 w-3.5" />Saved</span>;
  if (state === "error") return <span className="inline-flex items-center gap-1.5 px-1 text-xs text-danger"><AlertCircle className="h-3.5 w-3.5" />Not saved</span>;
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
      <Button variant="outline" onClick={() => setOpen((o) => !o)} loading={busy}><Download className="h-4 w-4" />Export</Button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-44 animate-scale-in rounded-lg border bg-raised p-1 shadow-pop" style={{ transformOrigin: "top right" }}>
          {(LOCAL_MODE ? [["csv", "Excel / CSV"]] : [["xlsx", "Excel (.xlsx)"], ["pdf", "PDF (A4)"], ["csv", "CSV"]]).map(([f, l]) => (
            <button key={f} onClick={() => run(f)} className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle">{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>
      <Card className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</Card>
    </div>
  );
}
