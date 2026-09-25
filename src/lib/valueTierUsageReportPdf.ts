// Dependency-free PDF for the Value Tier Usage Report (HP / MP / CM).
// Uses the shared Courier primitives in ./pdfBuilder, like the per-material
// Material Usage Report. Values are in rupees; the Courier font is ASCII-only
// so amounts are prefixed "Rs." rather than the rupee sign.

import { PdfToken, ascii, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

// Landscape A4 (points) - the tier summary is wide.
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN_X = 28;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 36;
const BODY_SIZE = 8;
const LINE_H = 10.5;

const PAGE_OPTS = { pageW: PAGE_W, pageH: PAGE_H, marginX: MARGIN_X, marginTop: MARGIN_TOP, lineH: LINE_H };
const MAX_LINES_PER_PAGE = Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LINE_H);

const LABEL_W = 26;
const CNT_W = 6;
const VAL_W = 13;
const PCT_W = 8;
const SUMMARY_RULE_W = LABEL_W + CNT_W + VAL_W * 6 + PCT_W * 2;

const MAT_W = 36;
const UNIT_W = 6;
const QTY_W = 12;
const DETAIL_RULE_W = MAT_W + UNIT_W + QTY_W * 3 + VAL_W * 2 + PCT_W;

function line(text: string, bold = false, size = BODY_SIZE): PdfToken {
  return { text: ascii(text), bold, size };
}

const BLANK = line("");

function money(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function signedMoney(n: number): string {
  return (n > 0 ? "+" : n < 0 ? "-" : "") + Math.round(Math.abs(n)).toLocaleString("en-IN");
}

function signedPct(n: number | null): string {
  if (n === null) return "-";
  return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
}

export interface TierSummaryPdfRow {
  label: string;
  materials: number;
  opening: number;
  receipts: number;
  usage: number;
  standard: number;
  variance: number;
  variancePct: number | null;
  closing: number;
  share: number;
}

export interface TierDetailPdfRow {
  code: string;
  name: string;
  unit: string;
  rate: number;
  usageQty: number;
  standardQty: number;
  usageValue: number;
  varianceValue: number;
  variancePct: number | null;
}

export interface TierTrendPdfRow {
  label: string;
  values: number[]; // one per tier, same order as tierLabels
  total: number;
}

export interface ValueTierUsageReportPdfOptions {
  periodLabel: string;
  viewLabel: string;
  filterLabel: string;
  generatedOn: string;
  summary: TierSummaryPdfRow[];
  total: TierSummaryPdfRow;
  details: { label: string; rows: TierDetailPdfRow[] }[];
  tierLabels: string[];
  trendColumnLabel: string;
  trend: TierTrendPdfRow[];
}

function summaryRow(r: TierSummaryPdfRow, bold = false): PdfToken {
  return line(
    padRight(r.label, LABEL_W - 1) + " " +
    padLeft(String(r.materials), CNT_W) +
    padLeft(money(r.opening), VAL_W) +
    padLeft(money(r.receipts), VAL_W) +
    padLeft(money(r.usage), VAL_W) +
    padLeft(money(r.standard), VAL_W) +
    padLeft(signedMoney(r.variance), VAL_W) +
    padLeft(signedPct(r.variancePct), PCT_W) +
    padLeft(money(r.closing), VAL_W) +
    padLeft(r.share.toFixed(1) + "%", PCT_W),
    bold
  );
}

export function buildValueTierUsageReportPdf(o: ValueTierUsageReportPdfOptions): Blob {
  const tokens: PdfToken[] = [];

  tokens.push(line("VALUE TIER USAGE REPORT", true, 14));
  tokens.push(line(`${o.viewLabel} | ${o.periodLabel} | ${o.filterLabel}`));
  tokens.push(line(`All amounts in Rs. (quantity x current material rate) | Generated ${o.generatedOn}`));

  tokens.push(BLANK, line("TIER SUMMARY (Rs.)", true, 10));
  tokens.push(line(
    padRight("Value Tier", LABEL_W) + padLeft("Mat.", CNT_W) + padLeft("Opening", VAL_W) + padLeft("Receipts", VAL_W) +
    padLeft("Actual Usage", VAL_W) + padLeft("Std Usage", VAL_W) + padLeft("Variance", VAL_W) + padLeft("Var %", PCT_W) +
    padLeft("Closing", VAL_W) + padLeft("Share", PCT_W),
    true
  ));
  tokens.push(line("-".repeat(SUMMARY_RULE_W)));
  o.summary.forEach((r) => tokens.push(summaryRow(r)));
  tokens.push(line("-".repeat(SUMMARY_RULE_W)));
  tokens.push(summaryRow(o.total, true));

  if (o.trend.length > 0) {
    const trendRuleW = LABEL_W + VAL_W * (o.tierLabels.length + 1);
    tokens.push(BLANK, line(`${o.viewLabel.toUpperCase()} USAGE VALUE BY TIER (Rs.)`, true, 10));
    tokens.push(line(
      padRight(o.trendColumnLabel, LABEL_W) + o.tierLabels.map((l) => padLeft(l, VAL_W)).join("") + padLeft("Total", VAL_W),
      true
    ));
    tokens.push(line("-".repeat(trendRuleW)));
    o.trend.forEach((t) => {
      tokens.push(line(padRight(t.label, LABEL_W - 1) + " " + t.values.map((v) => padLeft(money(v), VAL_W)).join("") + padLeft(money(t.total), VAL_W)));
    });
  }

  o.details.forEach((d) => {
    tokens.push(BLANK, line(`${d.label.toUpperCase()} - MATERIAL DETAIL`, true, 10));
    tokens.push(line(
      padRight("Material", MAT_W) + padLeft("Unit", UNIT_W) + padLeft("Rate", QTY_W) + padLeft("Usage Qty", QTY_W) +
      padLeft("Std Qty", QTY_W) + padLeft("Usage Rs.", VAL_W) + padLeft("Var Rs.", VAL_W) + padLeft("Var %", PCT_W),
      true
    ));
    tokens.push(line("-".repeat(DETAIL_RULE_W)));
    if (d.rows.length === 0) {
      tokens.push(line("  No usage in this period"));
    }
    d.rows.forEach((r) => {
      tokens.push(line(
        padRight(`${r.code} ${r.name}`, MAT_W - 1) + " " + padLeft(r.unit, UNIT_W) + padLeft(r.rate.toFixed(2), QTY_W) +
        padLeft(r.usageQty.toFixed(2), QTY_W) + padLeft(r.standardQty.toFixed(2), QTY_W) +
        padLeft(money(r.usageValue), VAL_W) + padLeft(signedMoney(r.varianceValue), VAL_W) + padLeft(signedPct(r.variancePct), PCT_W)
      ));
    });
  });

  // Paginate, repeating a small header on continuation pages.
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  tokens.forEach((t) => {
    if (page.length >= MAX_LINES_PER_PAGE) {
      pages.push(page);
      page = [line(`Value Tier Usage Report - ${o.periodLabel} (continued)`, true, 10), BLANK];
    }
    page.push(t);
  });
  if (page.length) pages.push(page);

  return renderTextPdf(pages, PAGE_OPTS);
}
