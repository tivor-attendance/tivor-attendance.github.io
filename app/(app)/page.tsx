"use client";

import { Suspense } from "react";
import { AttendanceGrid } from "@/components/attendance/attendance-grid";
import { formatDate, todayIST } from "@/lib/dates";

export default function HomePage() {
  return (
    <div>
      <div className="mb-8">
        <p className="text-sm text-muted">{formatDate(todayIST(), "long")}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-1.5 text-sm text-muted">Everyone is Present by default. Tap <b className="font-semibold text-rose-600">AB</b> for absentees and add a reason.</p>
      </div>
      <Suspense>
        <AttendanceGrid />
      </Suspense>
    </div>
  );
}
