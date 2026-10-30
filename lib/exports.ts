import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { MONTHS, WEEKDAYS_SHORT } from "./dates";
import { statusMap } from "./status";
import { summarize } from "./payroll";
import type { MonthGrid } from "./attendance";
import type { AppSettings } from "./settings-types";

export type Table = { headers: string[]; rows: (string | number | null)[][] };

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(t: Table): string {
  return "﻿" + [t.headers, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export async function toXlsx(t: Table, sheetName: string, title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([]);
  }
  const header = ws.addRow(t.headers);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1B2E" } }; });
  t.rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col, i) => { col.width = Math.min(40, Math.max(10, (t.headers[i]?.length ?? 8) + 4)); });
  ws.views = [{ state: "frozen", ySplit: title ? 3 : 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const SUMMARY_HEADERS = ["Present", "Absent", "Half Days", "Paid Leave", "LOP", "WFH", "Holidays", "Weekly Offs", "Total Paid Days", "LOP Days"];

export function registerTable(grid: MonthGrid): Table {
  const defs = statusMap(grid.statuses);
  return {
    headers: ["Emp ID", "Name", "Department", ...grid.days.map((d) => `${d.day} ${WEEKDAYS_SHORT[d.weekday]}`), ...SUMMARY_HEADERS],
    rows: grid.rows.map((r) => {
      const s = summarize(r.cells.map((c, i) => ({ status: c.status, companyWorking: grid.days[i].kind === "working" })), defs, grid.basis);
      return [r.empCode, r.name, r.department ?? "", ...r.cells.map((c, i) => (grid.days[i].future && c.source === "NONE" ? "" : c.status)),
        s.present, s.absent, s.halfDay, s.paidLeave, s.lop, s.wfh, s.holiday, s.weeklyOff, s.paidDays, s.lopDays];
    }),
  };
}

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

export async function registerXlsx(grid: MonthGrid, settings: AppSettings): Promise<Buffer> {
  const defs = statusMap(grid.statuses);
  const t = registerTable(grid);
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.companyName;
  const ws = wb.addWorksheet(`${MONTHS[grid.month - 1]} ${grid.year}`);
  ws.addRow([settings.companyName]).font = { bold: true, size: 14 };
  ws.addRow([`Attendance Register — ${MONTHS[grid.month - 1]} ${grid.year}${grid.lock ? " (Locked)" : ""}`]).font = { size: 11, color: { argb: "FF555555" } };
  ws.addRow([]);
  const header = ws.addRow(t.headers);
  header.font = { bold: true, size: 9 };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  header.height = 30;
  header.eachCell((c, col) => {
    const day = grid.days[col - 4];
    const color = day ? (day.kind === "holiday" ? "FFFFEDD5" : day.kind === "weeklyOff" ? "FFF1F5F9" : "FFEDE9FE") : "FFEDE9FE";
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    c.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
  for (const r of t.rows) {
    const row = ws.addRow(r);
    row.font = { size: 9 };
    row.eachCell((c, col) => {
      if (col >= 4 && col < 4 + grid.days.length) {
        const def = defs.get(String(c.value ?? ""));
        c.alignment = { horizontal: "center" };
        if (def) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(def.bg) } };
          c.font = { size: 9, bold: true, color: { argb: argb(def.fg) } };
        }
      } else if (col >= 4 + grid.days.length) {
        c.alignment = { horizontal: "center" };
        if (col >= 4 + grid.days.length + 8) c.font = { size: 9, bold: true };
      }
    });
  }
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 14;
  for (let i = 0; i < grid.days.length; i++) ws.getColumn(4 + i).width = 5;
  for (let i = 0; i < SUMMARY_HEADERS.length; i++) ws.getColumn(4 + grid.days.length + i).width = 9;
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 4 }];
  ws.addRow([]);
  ws.addRow(["Legend: " + grid.statuses.map((s) => `${s.code} = ${s.label}`).join(", ")]).font = { size: 8, italic: true };
  ws.addRow([]);
  ws.addRow(["Prepared by: ____________________", "", "", "", "", "", "", "", "", "", "Approved by: ____________________"]);
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function registerPdf(grid: MonthGrid, settings: AppSettings): Promise<Buffer> {
  const defs = statusMap(grid.statuses);
  const t = registerTable(grid);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width - 48;
  const fixed = { code: 40, name: 92 };
  const sumCols = [{ h: "P", i: 0 }, { h: "AB", i: 1 }, { h: "HD", i: 2 }, { h: "Lv", i: 3 }, { h: "LOP", i: 4 }, { h: "WFH", i: 5 }, { h: "H", i: 6 }, { h: "WO", i: 7 }, { h: "Paid", i: 8 }, { h: "LOPd", i: 9 }];
  const sumW = 22;
  const dayW = (pageW - fixed.code - fixed.name - sumCols.length * sumW) / grid.days.length;
  const rowH = 13;

  const header = () => {
    if (settings.companyLogo) {
      try { doc.image(Buffer.from(settings.companyLogo.split(",")[1], "base64"), 24, 18, { height: 26 }); } catch { /* ignore bad logo */ }
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text(settings.companyName, 24, 20, { width: pageW, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#555")
      .text(`Attendance Register — ${MONTHS[grid.month - 1]} ${grid.year}${grid.lock ? "  (Locked for payroll)" : ""}`, 24, 36, { width: pageW, align: "center" });
    let x = 24;
    const y = 54;
    doc.font("Helvetica-Bold").fontSize(6).fillColor("#111");
    doc.rect(24, y, pageW, rowH + 6).fill("#EDE9FE");
    doc.fillColor("#111").text("Emp ID", x + 2, y + 5, { width: fixed.code - 4 }); x += fixed.code;
    doc.text("Name", x + 2, y + 5, { width: fixed.name - 4 }); x += fixed.name;
    for (const d of grid.days) {
      if (d.kind !== "working") doc.rect(x, y, dayW, rowH + 6).fill(d.kind === "holiday" ? "#FFEDD5" : "#E2E8F0");
      doc.fillColor("#111").text(`${d.day}`, x, y + 2, { width: dayW, align: "center" });
      doc.fontSize(5).text(WEEKDAYS_SHORT[d.weekday].slice(0, 2), x, y + 10, { width: dayW, align: "center" }).fontSize(6);
      x += dayW;
    }
    for (const s of sumCols) { doc.text(s.h, x, y + 5, { width: sumW, align: "center" }); x += sumW; }
    return y + rowH + 6;
  };

  let y = header();
  doc.font("Helvetica").fontSize(6);
  const firstSum = 3 + grid.days.length;
  t.rows.forEach((r, ri) => {
    if (y + rowH > doc.page.height - 70) { doc.addPage(); y = header(); doc.font("Helvetica").fontSize(6); }
    if (ri % 2) doc.rect(24, y, pageW, rowH).fill("#FAFAFA");
    let x = 24;
    doc.fillColor("#111").text(String(r[0]), x + 2, y + 4, { width: fixed.code - 4, lineBreak: false }); x += fixed.code;
    doc.text(String(r[1]), x + 2, y + 4, { width: fixed.name - 4, lineBreak: false, ellipsis: true }); x += fixed.name;
    for (let i = 0; i < grid.days.length; i++) {
      const v = String(r[3 + i] ?? "");
      const def = defs.get(v);
      if (def && v !== "P") doc.rect(x + 0.5, y + 1, dayW - 1, rowH - 2).fill(def.bg);
      doc.fillColor(def?.fg ?? "#111").text(v, x, y + 4, { width: dayW, align: "center", lineBreak: false });
      x += dayW;
    }
    doc.fillColor("#111");
    for (const s of sumCols) { doc.text(String(r[firstSum + s.i]), x, y + 4, { width: sumW, align: "center", lineBreak: false }); x += sumW; }
    y += rowH;
  });
  doc.moveTo(24, y).lineTo(24 + pageW, y).strokeColor("#DDD").stroke();
  doc.fontSize(6).fillColor("#555").text("Legend: " + grid.statuses.map((s) => `${s.code}=${s.label}`).join("  "), 24, y + 6, { width: pageW });
  const sy = doc.page.height - 50;
  doc.fontSize(9).fillColor("#111");
  doc.text("Prepared by: ____________________________", 24, sy);
  doc.text("Approved by: ____________________________", 24 + pageW / 2, sy);
  doc.fontSize(7).fillColor("#888").text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 24, sy + 18);
  doc.end();
  return done;
}
