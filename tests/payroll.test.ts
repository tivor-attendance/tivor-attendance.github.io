import { describe, expect, it } from "vitest";
import { computeSalary, summarize } from "@/lib/payroll";
import { DEFAULT_STATUSES, statusMap } from "@/lib/status";

const defs = statusMap(DEFAULT_STATUSES);
const days = (codes: string[], working?: boolean[]) => codes.map((status, i) => ({ status, companyWorking: working ? working[i] : !["WO", "H"].includes(status) }));

// 30-day month: 4 Sundays (WO) + 1 holiday, rest present unless overridden
const base = (): string[] => Array.from({ length: 30 }, (_, i) => (i % 7 === 6 ? "WO" : "P"));

describe("paid days / LOP", () => {
  it("full month present → paid days = days in month, no LOP", () => {
    const s = summarize(days(base()), defs, "calendar");
    expect(s.lopDays).toBe(0);
    expect(s.paidDays).toBe(30);
    expect(s.present).toBe(26);
    expect(s.weeklyOff).toBe(4);
  });

  it("LOP = A + LOP + 0.5 × HD", () => {
    const m = base();
    m[0] = "AB"; m[1] = "AB"; m[2] = "LOP"; m[3] = "HD"; m[4] = "CL";
    const s = summarize(days(m), defs, "calendar");
    expect(s.lopDays).toBe(3.5);
    expect(s.paidDays).toBe(26.5);
    expect(s.absent).toBe(2);
    expect(s.halfDay).toBe(1);
    expect(s.paidLeave).toBe(1);
  });

  it("NA days (before joining / after exit) are excluded", () => {
    const m = base();
    for (let i = 0; i < 10; i++) m[i] = "NA";
    m[15] = "AB";
    const s = summarize(days(m), defs, "calendar");
    expect(s.na).toBe(10);
    expect(s.paidDays).toBe(19); // 20 eligible − 1 LOP
  });

  it("paid leave, WFH, OD, holidays and weekly offs are fully paid", () => {
    const m = base();
    m[0] = "SL"; m[1] = "EL"; m[2] = "WFH"; m[3] = "OD"; m[4] = "H";
    const s = summarize(days(m), defs, "calendar");
    expect(s.lopDays).toBe(0);
    expect(s.paidDays).toBe(30);
  });

  it("working-days basis counts only company working days", () => {
    const m = base();
    m[0] = "AB";
    const working = m.map((c) => c !== "WO");
    const s = summarize(days(m, working), defs, "working");
    expect(s.workingDays).toBe(26);
    expect(s.paidDays).toBe(25);
  });

  it("uses configurable payroll effects", () => {
    const custom = statusMap(DEFAULT_STATUSES.map((d) => (d.code === "WFH" ? { ...d, paid: 0.5 } : d)));
    const m = base();
    m[0] = "WFH";
    expect(summarize(days(m), custom, "calendar").lopDays).toBe(0.5);
  });
});

describe("salary", () => {
  it("pro-rates by paid days and computes LOP deduction", () => {
    const m = base();
    m[0] = "AB"; m[1] = "HD";
    const s = summarize(days(m), defs, "calendar");
    const pay = computeSalary(30000, 30, s);
    expect(pay.perDaySalary).toBe(1000);
    expect(pay.lopDeduction).toBe(1500);
    expect(pay.payableGross).toBe(28500);
  });

  it("never pays more than the monthly gross", () => {
    const s = summarize(days(base()), defs, "calendar");
    expect(computeSalary(31000, 31, s).payableGross).toBe(30000); // 30 paid days of a 31-day basis
    expect(computeSalary(30000, 26, summarize(days(base()), defs, "calendar")).payableGross).toBe(30000);
  });
});
