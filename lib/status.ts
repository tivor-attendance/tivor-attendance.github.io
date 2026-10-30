// Attendance status codes. Shared by client and server; the effective list is stored in
// Settings ("statuses") so colors and payroll effects can be changed without a deploy.

export type LeaveTypeCode = "CL" | "SL" | "EL";
export type SummaryBucket =
  | "present" | "absent" | "halfDay" | "paidLeave" | "lop"
  | "wfh" | "holiday" | "weeklyOff" | "na";

export interface StatusDef {
  code: string;
  label: string;
  /** Chip background / text colors (light mode; dark mode derives from these). */
  bg: string;
  fg: string;
  /** Fraction of the day that is paid (1, 0.5, 0). The unpaid remainder counts as LOP. */
  paid: number;
  /** false → the day is excluded from payroll entirely (e.g. NA). */
  counted: boolean;
  /** Leave type whose balance is deducted (1 day per cell). */
  leaveType: LeaveTypeCode | null;
  /** Single keyboard key that applies this status in the grid. */
  shortcut: string | null;
  /** Can be entered on future dates (planned leave). */
  plannable: boolean;
  /** Built-in codes cannot be removed. */
  system: boolean;
  bucket: SummaryBucket;
}

export const DEFAULT_STATUSES: StatusDef[] = [
  { code: "P", label: "Present", bg: "#ECFDF5", fg: "#047857", paid: 1, counted: true, leaveType: null, shortcut: "P", plannable: true, system: true, bucket: "present" },
  { code: "AB", label: "Absent", bg: "#FFF1F2", fg: "#BE123C", paid: 0, counted: true, leaveType: null, shortcut: "A", plannable: true, system: true, bucket: "absent" },
  { code: "HD", label: "Half Day", bg: "#FEF3C7", fg: "#92400E", paid: 0.5, counted: true, leaveType: null, shortcut: "H", plannable: true, system: true, bucket: "halfDay" },
  { code: "CL", label: "Casual Leave", bg: "#E0F2FE", fg: "#075985", paid: 1, counted: true, leaveType: "CL", shortcut: "C", plannable: true, system: false, bucket: "paidLeave" },
  { code: "SL", label: "Sick Leave", bg: "#FCE7F3", fg: "#9D174D", paid: 1, counted: true, leaveType: "SL", shortcut: "S", plannable: true, system: false, bucket: "paidLeave" },
  { code: "EL", label: "Earned Leave", bg: "#CCFBF1", fg: "#115E59", paid: 1, counted: true, leaveType: "EL", shortcut: "E", plannable: true, system: false, bucket: "paidLeave" },
  { code: "LOP", label: "Loss of Pay", bg: "#FFE4E6", fg: "#9F1239", paid: 0, counted: true, leaveType: null, shortcut: "L", plannable: true, system: false, bucket: "lop" },
  { code: "WFH", label: "Work From Home", bg: "#EDE9FE", fg: "#5B21B6", paid: 1, counted: true, leaveType: null, shortcut: "W", plannable: true, system: false, bucket: "wfh" },
  { code: "OD", label: "On Duty", bg: "#E0E7FF", fg: "#3730A3", paid: 1, counted: true, leaveType: null, shortcut: "O", plannable: true, system: false, bucket: "present" },
  { code: "H", label: "Holiday (Present)", bg: "#FFF7ED", fg: "#C2410C", paid: 1, counted: true, leaveType: null, shortcut: null, plannable: false, system: true, bucket: "present" },
  { code: "WO", label: "Weekly Off", bg: "#F4F4F5", fg: "#A1A1AA", paid: 1, counted: true, leaveType: null, shortcut: null, plannable: false, system: true, bucket: "weeklyOff" },
  { code: "NA", label: "Not Applicable", bg: "#F8FAFC", fg: "#94A3B8", paid: 0, counted: false, leaveType: null, shortcut: null, plannable: false, system: true, bucket: "na" },
];

export const SYSTEM_CODES = ["P", "AB", "HD", "H", "WO", "NA"] as const;

export function statusMap(defs: StatusDef[]): Map<string, StatusDef> {
  return new Map(defs.map((d) => [d.code, d]));
}

/** Simple mode: the only statuses a user can pick are Present and Absent. */
export const SELECTABLE_CODES = ["P", "AB"] as const;
export const ABSENT_CODE = "AB";

export function selectableStatuses(defs: StatusDef[]): StatusDef[] {
  return defs.filter((d) => (SELECTABLE_CODES as readonly string[]).includes(d.code));
}
