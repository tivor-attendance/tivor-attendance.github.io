import { z } from "zod";
import { fileResponse, requireUser, route, searchParams } from "@/lib/api";
import { getMonthGrid } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { registerPdf, registerTable, registerXlsx, toCsv } from "@/lib/exports";
import { monthQuerySchema } from "@/lib/validators";

export const GET = route(async (req) => {
  await requireUser(req, "reports:read");
  const q = searchParams(req);
  const { year, month } = monthQuerySchema.parse(q);
  const format = z.enum(["xlsx", "pdf", "csv"]).parse(q.format ?? "xlsx");
  const grid = await getMonthGrid(year, month, { department: q.department || undefined });
  const name = `attendance-register-${year}-${String(month).padStart(2, "0")}`;
  if (format === "csv") return fileResponse(toCsv(registerTable(grid)), `${name}.csv`, "text/csv; charset=utf-8");
  const settings = await getSettings();
  if (format === "pdf") return fileResponse(await registerPdf(grid, settings), `${name}.pdf`, "application/pdf");
  return fileResponse(await registerXlsx(grid, settings), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
