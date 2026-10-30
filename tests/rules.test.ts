import { describe, expect, it } from "vitest";
import { canEditMonth, canUnlockMonth, can, canViewSensitive } from "@/lib/permissions";
import { leaveDeltas } from "@/lib/leave";
import { DEFAULT_STATUSES, statusMap } from "@/lib/status";
import { settingsSchema, DEFAULT_SETTINGS } from "@/lib/settings-types";

describe("month lock rules", () => {
  it("locked months are read-only for every role", () => {
    for (const r of ["ADMIN", "HR", "MANAGER", "VIEWER"] as const) expect(canEditMonth(r, true)).toBe(false);
  });
  it("unlocked months are editable only by Admin/HR", () => {
    expect(canEditMonth("ADMIN", false)).toBe(true);
    expect(canEditMonth("HR", false)).toBe(true);
    expect(canEditMonth("MANAGER", false)).toBe(false);
    expect(canEditMonth("VIEWER", false)).toBe(false);
  });
  it("only Admin can unlock, and a reason is mandatory", () => {
    expect(canUnlockMonth("HR", "fix leave").ok).toBe(false);
    expect(canUnlockMonth("ADMIN", "").ok).toBe(false);
    expect(canUnlockMonth("ADMIN", "  ab ").ok).toBe(false);
    expect(canUnlockMonth("ADMIN", "Correct EMP004 sick leave").ok).toBe(true);
  });
  it("HR can lock but not unlock", () => {
    expect(can("HR", "months:lock")).toBe(true);
    expect(can("HR", "months:unlock")).toBe(false);
  });
});

describe("sensitive data", () => {
  it("Admin always, HR only when granted, others never", () => {
    expect(canViewSensitive({ role: "ADMIN", canViewSensitive: false })).toBe(true);
    expect(canViewSensitive({ role: "HR", canViewSensitive: false })).toBe(false);
    expect(canViewSensitive({ role: "HR", canViewSensitive: true })).toBe(true);
    expect(canViewSensitive({ role: "VIEWER", canViewSensitive: true })).toBe(false);
  });
});

describe("leave balance deltas", () => {
  const defs = statusMap(DEFAULT_STATUSES);
  it("P → CL uses one CL; CL → SL moves it; CL → P returns it", () => {
    const d = leaveDeltas([
      { employeeId: "e", date: "2026-03-02", before: "P", after: "CL" },
      { employeeId: "e", date: "2026-03-03", before: "CL", after: "SL" },
      { employeeId: "e", date: "2026-03-04", before: "CL", after: "P" },
    ], defs);
    expect(d).toEqual(expect.arrayContaining([
      { employeeId: "e", year: 2026, leaveType: "CL", delta: -1 },
      { employeeId: "e", year: 2026, leaveType: "SL", delta: 1 },
    ]));
    expect(d).toHaveLength(2);
  });
  it("non-leave changes and future first entries don't double count", () => {
    expect(leaveDeltas([{ employeeId: "e", date: "2026-03-02", before: "P", after: "AB" }], defs)).toEqual([]);
    expect(leaveDeltas([{ employeeId: "e", date: "2026-12-31", before: null, after: "EL" }], defs))
      .toEqual([{ employeeId: "e", year: 2026, leaveType: "EL", delta: 1 }]);
  });
});

describe("settings validation", () => {
  it("defaults are valid", () => expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true));
  it("system status codes cannot be removed", () => {
    const bad = { ...DEFAULT_SETTINGS, statuses: DEFAULT_SETTINGS.statuses.filter((s) => s.code !== "AB") };
    expect(settingsSchema.safeParse(bad).success).toBe(false);
  });
  it("duplicate shortcuts are rejected", () => {
    const bad = { ...DEFAULT_SETTINGS, statuses: DEFAULT_SETTINGS.statuses.map((s) => (s.code === "CL" ? { ...s, shortcut: "P" } : s)) };
    expect(settingsSchema.safeParse(bad).success).toBe(false);
  });
});
