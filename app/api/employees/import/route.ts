import { ApiError, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createEmployee } from "@/lib/employees";
import { readSheet, validateRows, type RowError } from "@/lib/import";

/** All-or-nothing import: any row error aborts the whole file and returns every error. */
export const POST = route(async (req) => {
  const user = await requireUser(req, "employees:write");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Upload an .xlsx or .csv file");
  if (file.size > 5 * 1024 * 1024) throw new ApiError(400, "File too large (max 5 MB)");
  const dryRun = form.get("dryRun") === "true";

  const rows = await readSheet(file);
  if (rows.length < 2) throw new ApiError(400, "The file has no data rows");
  const { parsed, errors } = validateRows(rows);

  const existing = await prisma.employee.findMany({ select: { id: true, empCode: true } });
  const codeToId = new Map(existing.map((e) => [e.empCode, e.id]));
  const fileCodes = new Set(parsed.map((p) => p.data.empCode).filter(Boolean));
  for (const p of parsed) {
    if (p.data.empCode && codeToId.has(p.data.empCode)) errors.push({ row: p.row, field: "empCode", message: `Employee ID ${p.data.empCode} already exists` });
    if (p.managerCode && !codeToId.has(p.managerCode) && !fileCodes.has(p.managerCode)) {
      errors.push({ row: p.row, field: "managerCode", message: `Manager ${p.managerCode} not found` });
    }
  }
  if (errors.length) return Response.json({ imported: 0, errors: errors.sort((a, b) => a.row - b.row) }, { status: 422 });
  if (dryRun) return { imported: 0, valid: parsed.length, errors: [] as RowError[] };

  const created = await prisma.$transaction(async (tx) => {
    const ids = new Map(codeToId);
    const made: { id: string; empCode: string; managerCode: string | null }[] = [];
    for (const p of parsed) {
      const emp = await createEmployee(p.data, user, tx);
      ids.set(emp.empCode, emp.id);
      made.push({ id: emp.id, empCode: emp.empCode, managerCode: p.managerCode });
    }
    for (const m of made) {
      if (m.managerCode) await tx.employee.update({ where: { id: m.id }, data: { managerId: ids.get(m.managerCode) } });
    }
    return made.length;
  }, { timeout: 120_000 });
  return { imported: created, errors: [] as RowError[] };
});
