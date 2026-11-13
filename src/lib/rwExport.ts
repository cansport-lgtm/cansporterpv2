import * as XLSX from "xlsx";
import { toast } from "@/hooks/use-toast";

export type RwSheet = { name: string; rows: Record<string, unknown>[] };

/**
 * Writes one .xlsx workbook with a sheet per report section.
 * Empty sections are skipped; if nothing has data the user gets a toast instead of an empty file.
 */
export function exportRwWorkbook(fileBase: string, sheets: RwSheet[]) {
  const filled = sheets.filter((s) => s.rows.length > 0);
  if (filled.length === 0) {
    toast({ title: "Nothing to export", description: "No data for the selected filters." });
    return;
  }
  const wb = XLSX.utils.book_new();
  filled.forEach((s) => {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    const headers = Object.keys(s.rows[0]);
    ws["!cols"] = headers.map((h) => ({
      wch: Math.min(40, Math.max(h.length, ...s.rows.map((r) => String(r[h] ?? "").length)) + 2),
    }));
    // Excel sheet names: max 31 chars, no []:*?/\
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
  });
  XLSX.writeFile(wb, `${fileBase}.xlsx`);
}
