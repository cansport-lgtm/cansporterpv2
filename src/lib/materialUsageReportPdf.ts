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
// Multi-material Single Day report: one comparison row per material for one
// date. Units can differ between materials (kg / ltr / pcs), so totals are
// grouped per unit rather than summed across units.

const M_CODE_W = 9;
const M_NAME_W = 22;
const M_UNIT_W = 5;
const M_NUM_W = 10;
const M_PCT_W = 8;
const MULTI_RULE_W = M_CODE_W + M_NAME_W + M_UNIT_W + M_NUM_W * 6 + M_PCT_W;

export interface MultiMaterialRowPdf {
  code: string;
  name: string;
  unit: string;
  opening: number;
  receipts: number;
  actual: number;
  standard: number;
  variance: number;
  closing: number;
  bomBreakdown: { productName: string; produced: number; bomRate: number; subtotal: number; departmentName: string }[];
}

export interface UnitTotalPdf {
  unit: string;
  count: number;
  actual: number;
  standard: number;
  variance: number;
  variancePct: number;
}

export interface MultiDepartmentUsagePdf extends DepartmentUsagePdf {
  unit: string;
}

export interface MultiMaterialUsageReportPdfOptions {
  dateLabel: string;
  tierLabel: string;
  generatedOn: string;
  rows: MultiMaterialRowPdf[];
  unitTotals: UnitTotalPdf[];
  overCount: number;
  underCount: number;
  avgVariancePct: number;
  departmentUsage: MultiDepartmentUsagePdf[];
  includeBomBreakdown: boolean;
}

function variancePctOf(actual: number, standard: number): number {
  return standard > 0 ? ((actual - standard) / standard) * 100 : actual > 0 ? 100 : 0;
}

function multiRow(
  code: string, name: string, unit: string,
  opening: string, receipts: string, actual: string, standard: string, variance: string, pct: string, closing: string,
  bold = false
): PdfToken {
  return line(
    padRight(code, M_CODE_W - 1) + " " +
    padRight(name, M_NAME_W - 1) + " " +
    padRight(unit, M_UNIT_W) +
    padLeft(opening, M_NUM_W) +
    padLeft(receipts, M_NUM_W) +
    padLeft(actual, M_NUM_W) +
    padLeft(standard, M_NUM_W) +
    padLeft(variance, M_NUM_W) +
    padLeft(pct, M_PCT_W) +
    padLeft(closing, M_NUM_W),
    bold,
    8
  );
}

export function buildMultiMaterialUsageReportPdf(o: MultiMaterialUsageReportPdfOptions): Blob {
  const tokens: PdfToken[] = [];

  tokens.push(line("MATERIAL USAGE REPORT - SINGLE DAY", true, 14));
  tokens.push(line(`${o.rows.length} material${o.rows.length === 1 ? "" : "s"} | ${o.dateLabel} | ${o.tierLabel}`, true, 11));
  tokens.push(line(`Generated ${o.generatedOn}`));

  tokens.push(BLANK, line("SUMMARY", true, 10));
  tokens.push(line(`Over standard: ${o.overCount}   Under standard: ${o.underCount}   Avg variance (per material): ${signed(o.avgVariancePct)}%`));
  o.unitTotals.forEach((t) => {
    tokens.push(line(
      `[${t.unit}] ${t.count} item${t.count === 1 ? "" : "s"} - Actual ${num(t.actual)}, Standard ${num(t.standard)}, ` +
      `Variance ${signed(t.variance)} (${signed(t.variancePct)}%)`
    ));
  });

  tokens.push(BLANK, line("MATERIAL COMPARISON", true, 10));
  tokens.push(multiRow("Code", "Material", "Unit", "Opening", "Receipts", "Actual", "Standard", "Variance", "Var %", "Closing", true));
  tokens.push(line("-".repeat(MULTI_RULE_W), false, 8));
  if (o.rows.length === 0) {
    tokens.push(line("  No consumption data found for this date"));
  } else {
    o.rows.forEach((r) => {
      tokens.push(multiRow(
        r.code, r.name, r.unit,
        num(r.opening), num(r.receipts), num(r.actual), num(r.standard), signed(r.variance),
        signed(variancePctOf(r.actual, r.standard)) + "%", num(r.closing)
      ));
    });
    tokens.push(line("-".repeat(MULTI_RULE_W), false, 8));
    o.unitTotals.forEach((t) => {
      tokens.push(multiRow(
        "Total", `${t.count} item${t.count === 1 ? "" : "s"}`, t.unit,
        "", "", num(t.actual), num(t.standard), signed(t.variance), signed(t.variancePct) + "%", "",
        true
      ));
    });
  }

  if (o.includeBomBreakdown) {
    const withBreakdown = o.rows.filter((r) => r.bomBreakdown.length > 0);
    tokens.push(BLANK, line("STANDARD (BOM) BREAKDOWN", true, 10));
    if (withBreakdown.length === 0) {
      tokens.push(line("  No BOM-linked production on this date"));
    } else {
      withBreakdown.forEach((r) => {
        tokens.push(line(`${r.code} - ${r.name} (${r.unit}): standard ${num(r.standard)}`, true));
        r.bomBreakdown.forEach((b) => {
          tokens.push(line(`    ${b.productName} (${b.departmentName}): ${b.produced} x ${b.bomRate} = ${b.subtotal.toFixed(2)}`, false, 7));
        });
      });
    }
  }

  tokens.push(BLANK, line("DEPARTMENT-WISE USAGE BREAKDOWN", true, 10));
  tokens.push(line(padRight("Unit", M_UNIT_W) + padRight("Department", DEPT_W - M_UNIT_W) +
    padLeft("Produced", DNUM_W) + padLeft("Standard", DNUM_W) + padLeft("Actual Est.", DNUM_W) + padLeft("% Unit", DPCT_W), true));
  tokens.push(line("-".repeat(DEPT_RULE_W)));
  if (o.departmentUsage.length === 0) {
    tokens.push(line("  No department-linked production on this date"));
  } else {
    o.departmentUsage.forEach((d) => {
      tokens.push(line(padRight(d.unit, M_UNIT_W - 1) + " " + padRight(d.departmentName, DEPT_W - M_UNIT_W) +
        padLeft(num(d.produced), DNUM_W) + padLeft(num(d.standard), DNUM_W) + padLeft(num(d.actualEst), DNUM_W) +
        padLeft(d.pctOfTotal.toFixed(1) + "%", DPCT_W)));
    });
    tokens.push(
      line("Standard usage is exact (from BOM); Actual Usage is estimated per material by prorating its actual", false, 7),
      line("consumption by each department's share of its standard usage. % is of the unit's standard total.", false, 7)
    );
  }

  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  tokens.forEach((t) => {
    if (page.length >= MAX_LINES_PER_PAGE) {
      pages.push(page);
      page = [line(`Material Usage Report - ${o.dateLabel} (continued)`, true, 10), BLANK];
    }
    page.push(t);
  });
  if (page.length) pages.push(page);

  return renderTextPdf(pages, PAGE_OPTS);
}
