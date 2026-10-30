import { fileResponse, requireUser, route } from "@/lib/api";
import { toXlsx } from "@/lib/exports";
import { IMPORT_COLUMNS } from "@/lib/import";

export const GET = route(async (req) => {
  await requireUser(req, "employees:write");
  const buf = await toXlsx({
    headers: IMPORT_COLUMNS.map((c) => c.header),
    rows: [["", "Jane Doe", "jane@company.com", "9876543210", "Engineering", "Developer", "", "2026-01-01", "", "", "FULL_TIME", "", "", "", "", ""]],
  }, "Employees");
  return fileResponse(buf, "employee-import-template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
