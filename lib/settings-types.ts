import { z } from "zod";
import { DEFAULT_STATUSES, type StatusDef } from "./status";

export type SaturdayRule = "none" | "second_fourth" | "all";
export interface WeeklyOffRule {
  sunday: boolean;
  saturday: SaturdayRule;
}
export type PayrollBasis = "calendar" | "working";

export interface AppSettings {
  companyName: string;
  companyAddress: string;
  companyLogo: string | null; // data URL
  weeklyOff: WeeklyOffRule;
  payrollBasis: PayrollBasis;
  statuses: StatusDef[];
  leaveAllotment: { CL: number; SL: number; EL: number };
  allowNegativeLeave: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Your Company Pvt. Ltd.",
  companyAddress: "",
  companyLogo: null,
  weeklyOff: { sunday: true, saturday: "none" },
  payrollBasis: "calendar",
  statuses: DEFAULT_STATUSES,
  leaveAllotment: { CL: 12, SL: 7, EL: 15 },
  allowNegativeLeave: true,
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB color");

export const statusDefSchema = z.object({
  code: z.string().trim().min(1).max(4).regex(/^[A-Z]+$/, "Uppercase letters only"),
  label: z.string().trim().min(1).max(40),
  bg: hex,
  fg: hex,
  paid: z.number().min(0).max(1),
  counted: z.boolean(),
  leaveType: z.enum(["CL", "SL", "EL"]).nullable(),
  shortcut: z.string().length(1).regex(/^[A-Z]$/).nullable(),
  plannable: z.boolean(),
  system: z.boolean(),
  bucket: z.enum(["present", "absent", "halfDay", "paidLeave", "lop", "wfh", "holiday", "weeklyOff", "na"]),
});

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  companyAddress: z.string().trim().max(300),
  companyLogo: z.string().max(300_000).startsWith("data:image/").nullable(),
  weeklyOff: z.object({ sunday: z.boolean(), saturday: z.enum(["none", "second_fourth", "all"]) }),
  payrollBasis: z.enum(["calendar", "working"]),
  statuses: z.array(statusDefSchema).min(1).superRefine((list, ctx) => {
    const codes = new Set<string>();
    const keys = new Set<string>();
    for (const s of list) {
      if (codes.has(s.code)) ctx.addIssue({ code: "custom", message: `Duplicate code ${s.code}` });
      codes.add(s.code);
      if (s.shortcut) {
        if (keys.has(s.shortcut)) ctx.addIssue({ code: "custom", message: `Shortcut ${s.shortcut} used twice` });
        keys.add(s.shortcut);
      }
    }
    for (const c of ["P", "AB", "HD", "H", "WO", "NA"]) {
      if (!codes.has(c)) ctx.addIssue({ code: "custom", message: `System code ${c} cannot be removed` });
    }
  }),
  leaveAllotment: z.object({ CL: z.number().min(0).max(365), SL: z.number().min(0).max(365), EL: z.number().min(0).max(365) }),
  allowNegativeLeave: z.boolean(),
});
