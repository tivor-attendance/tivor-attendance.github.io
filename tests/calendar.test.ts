import { describe, expect, it } from "vitest";
import { dayKind, defaultStatus, isWeeklyOff, planGeneration, type CalendarContext } from "@/lib/calendar";
import { todayIST } from "@/lib/dates";

const ctx = (over: Partial<CalendarContext> = {}): CalendarContext => ({
  holidays: new Map(),
  overrides: new Map(),
  weeklyOff: { sunday: true, saturday: "none" },
  ...over,
});
const emp = { dateOfJoining: "2026-01-01", dateOfExit: null };

describe("daily auto-generation defaults", () => {
  it("Mon–Sat → P, Sunday → WO", () => {
    expect(defaultStatus("2026-03-02", emp, ctx())).toBe("P"); // Monday
    expect(defaultStatus("2026-03-07", emp, ctx())).toBe("P"); // Saturday
    expect(defaultStatus("2026-03-08", emp, ctx())).toBe("WO"); // Sunday
  });

  it("holiday → H", () => {
    const c = ctx({ holidays: new Map([["2026-01-26", { name: "Republic Day", type: "NATIONAL" }]]) });
    expect(defaultStatus("2026-01-26", emp, c)).toBe("H");
  });

  it("before joining / after exit → NA", () => {
    const e = { dateOfJoining: "2026-03-10", dateOfExit: "2026-03-20" };
    expect(defaultStatus("2026-03-09", e, ctx())).toBe("NA");
    expect(defaultStatus("2026-03-10", e, ctx())).toBe("P");
    expect(defaultStatus("2026-03-20", e, ctx())).toBe("P");
    expect(defaultStatus("2026-03-21", e, ctx())).toBe("NA");
  });

  it("working-day override beats Sunday and holiday; day-off override beats working day", () => {
    const c = ctx({
      holidays: new Map([["2026-03-09", { name: "X", type: "COMPANY" }]]),
      overrides: new Map([["2026-03-08", true], ["2026-03-09", true], ["2026-03-10", false]]),
    });
    expect(defaultStatus("2026-03-08", emp, c)).toBe("P");
    expect(defaultStatus("2026-03-09", emp, c)).toBe("P");
    expect(defaultStatus("2026-03-10", emp, c)).toBe("WO");
  });

  it("2nd & 4th Saturday rule", () => {
    const rule = { sunday: true, saturday: "second_fourth" as const };
    // March 2026 Saturdays: 7, 14, 21, 28
    expect(isWeeklyOff("2026-03-07", rule)).toBe(false);
    expect(isWeeklyOff("2026-03-14", rule)).toBe(true);
    expect(isWeeklyOff("2026-03-21", rule)).toBe(false);
    expect(isWeeklyOff("2026-03-28", rule)).toBe(true);
    expect(isWeeklyOff("2026-03-28", { sunday: true, saturday: "all" })).toBe(true);
    expect(dayKind("2026-03-14", ctx({ weeklyOff: rule }))).toBe("weeklyOff");
  });

  it("planGeneration only materialises employed days", () => {
    const plan = planGeneration(
      ["2026-03-07", "2026-03-08", "2026-03-09"],
      [{ id: "a", ...emp }, { id: "b", dateOfJoining: "2026-03-09", dateOfExit: null }],
      ctx(),
    );
    expect(plan).toEqual([
      { employeeId: "a", date: "2026-03-07", status: "P" },
      { employeeId: "a", date: "2026-03-08", status: "WO" },
      { employeeId: "a", date: "2026-03-09", status: "P" },
      { employeeId: "b", date: "2026-03-09", status: "P" },
    ]);
  });
});

describe("IST dates", () => {
  it("uses Asia/Kolkata for 'today'", () => {
    // 2026-03-01 20:00 UTC is already 2 March in IST
    expect(todayIST(new Date("2026-03-01T20:00:00Z"))).toBe("2026-03-02");
    expect(todayIST(new Date("2026-03-01T18:00:00Z"))).toBe("2026-03-01");
  });
});
