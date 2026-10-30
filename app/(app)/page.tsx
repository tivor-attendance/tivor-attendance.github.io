"use client";

import { Suspense } from "react";
import { AttendanceGrid } from "@/components/attendance/attendance-grid";
import { TodayLabel } from "@/components/today-label";

export default function HomePage() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Attendance</h1>
          <p className="mt-1 text-sm text-muted">Everyone is present by default. Mark half days and absences with a reason.</p>
        </div>
        <TodayLabel inline />
      </div>
      <Suspense>
        <AttendanceGrid />
      </Suspense>
    </div>
  );
}
