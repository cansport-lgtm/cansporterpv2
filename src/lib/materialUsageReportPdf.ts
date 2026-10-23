// Dependency-free PDF for the Material Usage Report (Daily / Monthly / Single Day).
// Uses the shared Courier primitives in ./pdfBuilder - no jspdf available in this
// environment. Mirrors the on-screen/print-window report: usage table (with the
// per-product BOM breakdown), the opening/receipts/closing summary, and the
// department-wise usage breakdown.

import { PdfToken, ascii, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

// Portrait A4 (points).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 32;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 40;
const BODY_SIZE = 8.5;
const LINE_H = 11.5;

const PAGE_OPTS = { pageW: PAGE_W, pageH: PAGE_H, marginX: MARGIN_X, marginTop: MARGIN_TOP, lineH: LINE_H };
const MAX_LINES_PER_PAGE = Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LINE_H);

const PERIOD_W = 16;
const NUM_W = 11;
const PCT_W = 8;
const USAGE_RULE_W = PERIOD_W + NUM_W * 3 + PCT_W;

const DEPT_W = 22;
const DNUM_W = 12;
const DPCT_W = 9;
const DEPT_RULE_W = DEPT_W + DNUM_W * 3 + DPCT_W;

function line(text: string, bold = false, size = BODY_SIZE): PdfToken {
  return { text: ascii(text), bold, size };
}

const BLANK = line("");

function num(n: number): string {
  return n.toFixed(2);
}

function signed(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

export interface UsageRowPdf {
  label: string;
  actual: number;
  standard: number;
  variance: number;
  bomBreakdown: { productName: string; produced: number; bomRate: number; subtotal: number; departmentName: string }[];
}

export interface SummaryRowPdf {
  label: string;
  opening: number;
  receipts: number;
  usage: number;
  closing: number;
}

export interface DepartmentUsagePdf {
  departmentName: string;
  produced: number;
  standard: number;
  actualEst: number;
  pctOfTotal: number;
}

export interface MaterialUsageReportPdfOptions {
  materialCode: string;
  materialName: string;
  unit: string;
  periodLabel: string;
  viewLabel: string;
  periodColumnLabel: string;
  generatedOn: string;
  totals: { actual: number; standard: number; variance: number; variancePct: number };
  usageRows: UsageRowPdf[];
  summaryRows: SummaryRowPdf[];
  departmentUsage: DepartmentUsagePdf[];
}

function usageRow(periodLabel: string, actual: string, standard: string, variance: string, pct: string, bold = false): PdfToken {
  return line(
    padRight(periodLabel, PERIOD_W) +
    padLeft(actual, NUM_W) +
    padLeft(standard, NUM_W) +
    padLeft(variance, NUM_W) +
    padLeft(pct, PCT_W),
    bold
  );
}

function usageHeaderRow(periodColumnLabel: string): PdfToken {
  return usageRow(periodColumnLabel, "Actual", "Standard", "Variance", "Var %", true);
}

function summaryRow(label: string, opening: string, receipts: string, usage: string, closing: string, bold = false): PdfToken {
  return line(
    padRight(label, PERIOD_W) +
    padLeft(opening, NUM_W) +
    padLeft(receipts, NUM_W) +
    padLeft(usage, NUM_W) +
    padLeft(closing, NUM_W),
    bold
  );
}

function deptRow(dept: string, produced: string, standard: string, actualEst: string, pct: string, bold = false): PdfToken {
  return line(
    padRight(dept, DEPT_W) +
    padLeft(produced, DNUM_W) +
    padLeft(standard, DNUM_W) +
    padLeft(actualEst, DNUM_W) +
    padLeft(pct, DPCT_W),
    bold
  );
}

export function buildMaterialUsageReportPdf(o: MaterialUsageReportPdfOptions): Blob {
  const tokens: PdfToken[] = [];

  tokens.push(line("MATERIAL USAGE REPORT", true, 14));
  tokens.push(line(`${o.materialCode} - ${o.materialName}`, true, 11));
  tokens.push(line(`${o.viewLabel} | ${o.periodLabel} | Unit: ${o.unit}`));
  tokens.push(line(`Generated ${o.generatedOn}`));

  tokens.push(BLANK, line("SUMMARY", true, 10));
  tokens.push(line(`Total Actual: ${num(o.totals.actual)} ${o.unit}`));
  tokens.push(line(`Total Standard: ${num(o.totals.standard)} ${o.unit}`));
  tokens.push(line(`Variance: ${signed(o.totals.variance)} ${o.unit}  (${signed(o.totals.variancePct)}%)`));

  tokens.push(BLANK, line(`${o.viewLabel.toUpperCase()} USAGE DATA`, true, 10));
  tokens.push(usageHeaderRow(o.periodColumnLabel));
  tokens.push(line("-".repeat(USAGE_RULE_W)));
  if (o.usageRows.length === 0) {
    tokens.push(line("  No consumption data found for this period"));
  } else {
    o.usageRows.forEach((r) => {
      tokens.push(usageRow(r.label, num(r.actual), num(r.standard), signed(r.variance), signed(r.standard > 0 ? (r.variance / r.standard) * 100 : r.actual > 0 ? 100 : 0) + "%"));
      r.bomBreakdown.forEach((b) => {
        tokens.push(line(`    ${b.productName} (${b.departmentName}): ${b.produced} x ${b.bomRate} = ${b.subtotal.toFixed(2)}`, false, 7));
      });
    });
    tokens.push(line("-".repeat(USAGE_RULE_W)));
    tokens.push(usageRow("Total", num(o.totals.actual), num(o.totals.standard), signed(o.totals.variance), signed(o.totals.variancePct) + "%", true));
  }

  tokens.push(BLANK, line(`${o.viewLabel.toUpperCase()} SUMMARY - OPENING, RECEIPTS, USAGE & CLOSING`, true, 10));
  tokens.push(summaryRow(o.periodColumnLabel, "Opening", "Receipts", "Usage", "Closing", true));
  tokens.push(line("-".repeat(USAGE_RULE_W)));
  if (o.summaryRows.length === 0) {
    tokens.push(line("  No data found for this period"));
  } else {
    o.summaryRows.forEach((r) => {
      tokens.push(summaryRow(r.label, num(r.opening), num(r.receipts), num(r.usage), num(r.closing)));
    });
    const totalReceipts = o.summaryRows.reduce((s, r) => s + r.receipts, 0);
    const totalUsage = o.summaryRows.reduce((s, r) => s + r.usage, 0);
    const firstOpening = o.summaryRows[0]?.opening || 0;
    const lastClosing = o.summaryRows[o.summaryRows.length - 1]?.closing || 0;
    tokens.push(line("-".repeat(USAGE_RULE_W)));
    tokens.push(summaryRow("Total / Net", num(firstOpening), num(totalReceipts), num(totalUsage), num(lastClosing), true));
  }

  tokens.push(BLANK, line("DEPARTMENT-WISE USAGE BREAKDOWN", true, 10));
  tokens.push(deptRow("Department", "Produced", "Standard", "Actual Est.", "% Total", true));
  tokens.push(line("-".repeat(DEPT_RULE_W)));
  if (o.departmentUsage.length === 0) {
    tokens.push(line("  No department-linked production in this period"));
  } else {
    o.departmentUsage.forEach((d) => {
      tokens.push(deptRow(d.departmentName, num(d.produced), num(d.standard), num(d.actualEst), d.pctOfTotal.toFixed(1) + "%"));
    });
    tokens.push(
      line("Standard usage is exact (from BOM); Actual Usage is estimated by prorating total actual", false, 7),
      line("consumption across departments by their share of standard usage.", false, 7)
    );
  }

  // Paginate, repeating a small header on continuation pages.
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  tokens.forEach((t) => {
    if (page.length >= MAX_LINES_PER_PAGE) {
      pages.push(page);
      page = [line(`Material Usage Report - ${o.materialCode} (continued)`, true, 10), BLANK];
    }
    page.push(t);
  });
  if (page.length) pages.push(page);

  return renderTextPdf(pages, PAGE_OPTS);
}

// ---------------------------------------------------------------------------
// Item-wise Single Day report for several materials: one block per material,
// each in its own unit (kg / ltr are never added together). A block is never
// split across pages; later materials continue on page 2.

const M_UNIT_W = 5;
const I_NUM_W = 12;
const ITEM_RULE_W = I_NUM_W * 6;

export type MaterialStatusPdf = "over" | "under" | "on" | "nostd" | "idle";

export interface MultiMaterialRowPdf {
  code: string;
  name: string;
  unit: string;
  status: MaterialStatusPdf;
  opening: number;
  receipts: number;
  actual: number;
  standard: number;
  variance: number;
  variancePct: number;
  closing: number;
  bomBreakdown: { productName: string; produced: number; bomRate: number; subtotal: number; departmentName: string }[];
}

export interface MultiDepartmentUsagePdf extends DepartmentUsagePdf {
  unit: string;
}

export interface MultiMaterialUsageReportPdfOptions {
  dateLabel: string;
  tierLabel: string;
  generatedOn: string;
  statusLine: string;
  rows: MultiMaterialRowPdf[];
  departmentUsage: MultiDepartmentUsagePdf[];
  includeBomBreakdown: boolean;
}

function statusLabel(r: MultiMaterialRowPdf): string {
  switch (r.status) {
    case "over": return `${signed(r.variancePct)}% OVER`;
    case "under": return `${signed(r.variancePct)}% UNDER`;
    case "on": return "ON STANDARD";
    case "nostd": return "NO STANDARD";
    default: return "NO ACTIVITY";
  }
}

function itemRow(cells: string[], bold = false): PdfToken {
  return line(cells.map((c) => padLeft(c, I_NUM_W)).join(""), bold);
}

export function buildMultiMaterialUsageReportPdf(o: MultiMaterialUsageReportPdfOptions): Blob {
  // Groups of lines that must stay on one page.
  const blocks: PdfToken[][] = [];

  blocks.push([
    line("MATERIAL USAGE REPORT - ITEM-WISE", true, 14),
    line(`${o.dateLabel} | ${o.rows.length} material${o.rows.length === 1 ? "" : "s"} | ${o.tierLabel}`, true, 11),
    line(o.statusLine.replace(/ · /g, ", ")),
    line(`Generated ${o.generatedOn}  -  each material in its own unit`),
    BLANK,
  ]);

  if (o.rows.length === 0) {
    blocks.push([line("  No consumption data found for this date"), BLANK]);
  }

  o.rows.forEach((r, i) => {
    const title = `${i + 1}. ${r.code} - ${r.name} (${r.unit})`;
    const status = statusLabel(r);
    const hasVariance = r.status === "over" || r.status === "under" || r.status === "on";
    const block: PdfToken[] = [
      line(padRight(title, ITEM_RULE_W - status.length - 1) + " " + status, true, 9.5),
      itemRow(["Opening", "Receipts", "Actual", "Standard", "Variance", "Closing"], true),
      itemRow([
        num(r.opening), num(r.receipts), num(r.actual), num(r.standard),
        hasVariance ? signed(r.variance) : "-", num(r.closing),
      ]),
    ];
    if (o.includeBomBreakdown) {
      if (r.bomBreakdown.length > 0) {
        r.bomBreakdown.forEach((b) => {
          block.push(line(`    ${b.productName} (${b.departmentName}): ${b.produced} x ${b.bomRate} = ${b.subtotal.toFixed(2)}`, false, 7));
        });
      } else if (r.status === "nostd") {
        block.push(line("    No BOM-linked production recorded for this date.", false, 7));
      }
    }
    block.push(line("-".repeat(ITEM_RULE_W)));
    blocks.push(block);
  });

  const dept: PdfToken[] = [BLANK, line("DEPARTMENT-WISE USAGE BREAKDOWN", true, 10)];
  dept.push(line(padRight("Unit", M_UNIT_W) + padRight("Department", DEPT_W - M_UNIT_W) +
    padLeft("Produced", DNUM_W) + padLeft("Standard", DNUM_W) + padLeft("Actual Est.", DNUM_W) + padLeft("% Unit", DPCT_W), true));
  dept.push(line("-".repeat(DEPT_RULE_W)));
  if (o.departmentUsage.length === 0) {
    dept.push(line("  No department-linked production on this date"));
  } else {
    o.departmentUsage.forEach((d) => {
      dept.push(line(padRight(d.unit, M_UNIT_W - 1) + " " + padRight(d.departmentName, DEPT_W - M_UNIT_W) +
        padLeft(num(d.produced), DNUM_W) + padLeft(num(d.standard), DNUM_W) + padLeft(num(d.actualEst), DNUM_W) +
        padLeft(d.pctOfTotal.toFixed(1) + "%", DPCT_W)));
    });
    dept.push(
      line("Standard usage is exact (from BOM); Actual Usage is estimated per material by prorating its actual", false, 7),
      line("consumption by each department's share of its standard usage. % is of the unit's standard total.", false, 7)
    );
  }
  // The department table may split across pages, one row at a time.
  dept.forEach((t) => blocks.push([t]));

  const continued = () => [line(`Material Usage Report - Item-wise - ${o.dateLabel} (continued)`, true, 10), BLANK];
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  blocks.forEach((block) => {
    if (page.length > 0 && page.length + block.length > MAX_LINES_PER_PAGE) {
      pages.push(page);
      page = continued();
    }
    page.push(...block);
  });
  if (page.length) pages.push(page);

  return renderTextPdf(pages, PAGE_OPTS);
}
