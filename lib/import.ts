import ExcelJS from "exceljs";
import { employeeSchema } from "./validators";

export const IMPORT_COLUMNS = [
  { key: "empCode", header: "Employee ID (blank = auto)" },
  { key: "name", header: "Full Name *" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "department", header: "Department" },
  { key: "designation", header: "Designation" },
  { key: "managerCode", header: "Reporting Manager Emp ID" },
  { key: "dateOfJoining", header: "Date of Joining * (YYYY-MM-DD)" },
  { key: "dateOfExit", header: "Date of Exit (YYYY-MM-DD)" },
  { key: "dateOfBirth", header: "Date of Birth (YYYY-MM-DD)" },
  { key: "employmentType", header: "Employment Type (FULL_TIME/PART_TIME/INTERN/CONTRACT)" },
  { key: "monthlySalary", header: "Monthly Gross Salary" },
  { key: "bankAccount", header: "Bank Account No." },
  { key: "ifsc", header: "IFSC" },
  { key: "pan", header: "PAN" },
  { key: "uan", header: "UAN" },
] as const;

type Key = (typeof IMPORT_COLUMNS)[number]["key"];

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function readSheet(file: File): Promise<string[][]> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((r) => {
    const vals: string[] = [];
    for (let c = 1; c <= IMPORT_COLUMNS.length; c++) vals.push(cellText(r.getCell(c).value));
    if (vals.some(Boolean)) rows.push(vals);
  });
  return rows;
}

export interface RowError { row: number; field: string; message: string }

/** Validate every data row (row 1 = header). Returns parsed rows or row-level errors. */
export function validateRows(rows: string[][]) {
  const errors: RowError[] = [];
  const parsed: { row: number; managerCode: string | null; data: ReturnType<typeof employeeSchema.parse> }[] = [];
  const codes = new Set<string>();
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c, idx) => [c.key, (cells[idx] ?? "").trim()])) as Record<Key, string>;
    const res = employeeSchema.safeParse({
      ...raw,
      empCode: raw.empCode || undefined,
      employmentType: raw.employmentType || undefined,
      managerId: null,
    });
    if (!res.success) {
      for (const issue of res.error.issues) errors.push({ row: rowNo, field: String(issue.path[0] ?? ""), message: issue.message });
      return;
    }
    if (res.data.empCode) {
      if (codes.has(res.data.empCode)) errors.push({ row: rowNo, field: "empCode", message: `Duplicate Employee ID ${res.data.empCode} in file` });
      codes.add(res.data.empCode);
    }
    parsed.push({ row: rowNo, managerCode: raw.managerCode || null, data: res.data });
  });
  return { parsed, errors };
}
