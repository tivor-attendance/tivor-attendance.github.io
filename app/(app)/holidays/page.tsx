"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PartyPopper, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { api, useApi } from "@/lib/client";
import { WEEKDAYS_SHORT, formatDate, parseISO, todayIST, weekday } from "@/lib/dates";

interface Holiday { id: string; date: string; name: string; type: string }

export default function HolidaysPage() {
  const confirm = useConfirm();
  const [year, setYear] = useState(parseISO(todayIST()).year);
  const { data, loading, reload } = useApi<{ holidays: Holiday[] }>(`/api/holidays?year=${year}`);
  const [date, setDate] = useState(todayIST());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Enter the holiday name");
    setBusy(true);
    try {
      await api("/api/holidays", { body: { date, name: name.trim(), type: "NATIONAL" } });
      toast.success(`${name.trim()} added — everyone counted Present on ${formatDate(date)}`);
      setName("");
      if (parseISO(date).year !== year) setYear(parseISO(date).year); else reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: Holiday) => {
    if (!(await confirm({ title: `Remove ${h.name}?`, body: `${formatDate(h.date)} becomes a normal working day again.`, danger: true, confirmLabel: "Remove" }))) return;
    try {
      await api(`/api/holidays/${h.id}`, { method: "DELETE" });
      toast.success("Holiday removed");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const today = todayIST();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Holidays</h1>
        <p className="mt-1.5 text-sm text-muted">Public holidays are marked <b className="text-fg">H</b> for everyone and counted as present — even if P or AB was marked that day.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Holiday name" className="min-w-56 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" /></Field>
          <Button type="submit" loading={busy}><Plus className="h-4 w-4" />Add holiday</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">Holidays in {year}</h3>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28 rounded-full">
            {Array.from({ length: 6 }, (_, i) => parseISO(today).year - 3 + i).map((y) => <option key={y}>{y}</option>)}
          </Select>
        </div>
        {loading && !data ? <div className="p-4"><Skeleton className="h-24" /></div>
          : !data?.holidays.length ? <EmptyState icon={<PartyPopper className="h-5 w-5" />} title={`No holidays added for ${year}`} description="Add Pongal, Independence Day, Diwali and other office holidays above." />
            : (
              <ul className="divide-y">
                {data.holidays.map((h) => {
                  const { day, month } = parseISO(h.date);
                  const past = h.date < today;
                  return (
                    <li key={h.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border ${past ? "bg-subtle text-muted" : "bg-card text-fg"}`}>
                        <span className="text-lg font-semibold leading-none">{day}</span>
                        <span className="text-[10px] uppercase">{new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" })}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{h.name}</p>
                        <p className="text-sm text-muted">{WEEKDAYS_SHORT[weekday(h.date)]} · {past ? "Done" : "Upcoming"}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => remove(h)} aria-label={`Remove ${h.name}`}><Trash2 className="h-4 w-4 text-danger" /></Button>
                    </li>
                  );
                })}
              </ul>
            )}
      </Card>
    </div>
  );
}
