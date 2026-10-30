"use client";

import { useEffect, useState } from "react";
import { formatDate, todayIST } from "@/lib/dates";

/** Shows today's date (IST) and updates itself when the day changes. */
export function TodayLabel() {
  const [today, setToday] = useState(todayIST());
  useEffect(() => {
    const t = setInterval(() => setToday(todayIST()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <p key={today} className="animate-fade-up text-sm text-muted">{formatDate(today, "long")}</p>;
}
