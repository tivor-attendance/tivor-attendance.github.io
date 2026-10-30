"use client";

import { Suspense } from "react";
import { AttendanceGrid } from "@/components/attendance/attendance-grid";
import { TodayLabel } from "@/components/today-label";

export default function HomePage() {
  return (
    <div>
      <div className="mb-8">
        <TodayLabel />
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-1.5 text-sm text-muted">Everyone is Present by default. Mark <b className="font-semibold text-fg">HD</b> for half days and <b className="font-semibold text-fg">AB</b> for absentees — each needs a reason.</p>
      </div>
      <Suspense>
        <AttendanceGrid />
      </Suspense>
    </div>
  );
}
