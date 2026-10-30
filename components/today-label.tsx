"use client";

import { useEffect, useState } from "react";
import { formatDate, todayIST } from "@/lib/dates";

/** Today's date (IST); updates itself when the day changes. */
export function TodayLabel({ inline }: { inline?: boolean }) {
  const [today, setToday] = useState(todayIST());
  useEffect(() => {
    const t = setInterval(() => setToday(todayIST()), 30_000);
    return () => clearInterval(t);
  }, []);
  const text = formatDate(today, "long");
  if (inline) return <span key={today} className="ml-1 inline-flex animate-fade-in items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-fg-2"><span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-[var(--st-p-fg)]" />{text}</span>;
  return <p key={today} className="animate-fade-up text-sm text-muted">{text}</p>;
}
