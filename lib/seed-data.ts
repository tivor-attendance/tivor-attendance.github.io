// Real attendance log (Sep–Nov 2026) entered from the office sheet.
// Blank cells in the sheet = Present, so only absences are listed here.
import type { ISODate } from "./dates";

export const SEED_EMPLOYEES: { code: string; name: string; dateOfJoining: ISODate }[] = [
  { code: "EMP001", name: "Uday Vamsi", dateOfJoining: "2026-09-01" },
  { code: "EMP002", name: "Dinesh", dateOfJoining: "2026-09-01" },
  { code: "EMP003", name: "Adhithya", dateOfJoining: "2026-09-01" },
  { code: "EMP004", name: "Abinaya", dateOfJoining: "2026-09-01" },
  { code: "EMP005", name: "Kamalam Krishnan", dateOfJoining: "2026-09-01" },
  { code: "EMP006", name: "Priyanka", dateOfJoining: "2026-09-01" },
  { code: "EMP007", name: "Pranay V", dateOfJoining: "2026-09-01" },
  { code: "EMP008", name: "Harshan", dateOfJoining: "2026-09-01" },
  { code: "EMP009", name: "Yashwanth", dateOfJoining: "2026-09-01" },
  { code: "EMP010", name: "John Bellarmine", dateOfJoining: "2026-10-22" },
];

const NR = "Not recorded";
const ab = (code: string, days: string[], month: string, reason = NR) => days.map((d) => [code, `2026-${month}-${d.padStart(2, "0")}`, reason] as const);

/** [employee code, date, reason] */
export const SEED_ABSENCES: (readonly [string, ISODate, string])[] = [
  // September 2026
  ...ab("EMP001", ["17"], "09"),
  ...ab("EMP002", ["26"], "09"),
  ...ab("EMP003", ["22", "30"], "09"),
  ...ab("EMP005", ["17", "18", "21", "23", "25", "29", "30"], "09"),
  ...ab("EMP006", ["17", "18", "21", "23", "25", "28"], "09"),
  ...ab("EMP007", ["30"], "09"),
  ...ab("EMP008", ["21"], "09"),
  // October 2026
  ...ab("EMP001", ["20", "21", "22", "23"], "10"),
  ...ab("EMP003", ["10", "20"], "10"),
  ...ab("EMP005", ["14"], "10", "Exam"),
  ...ab("EMP005", ["17", "24", "26"], "10"),
  ...ab("EMP006", ["14"], "10", "Exam"),
  ...ab("EMP007", ["6", "9"], "10", "PR"),
  ...ab("EMP007", ["14", "21"], "10", "Exam"),
  ...ab("EMP008", ["7", "10", "26"], "10"),
  ...ab("EMP009", ["20", "24"], "10"),
  ...ab("EMP010", ["23", "24", "28"], "10"),
  // November 2026 (planned)
  ...ab("EMP005", ["3", "4", "5", "6"], "11"),
  ...ab("EMP005", ["16", "17", "18"], "11", "Exam"),
  ...ab("EMP006", ["12"], "11"),
  ...ab("EMP006", ["16", "17", "18"], "11", "Exam"),
  ...ab("EMP007", ["4", "6", "12", "20"], "11", "Exam"),
];
