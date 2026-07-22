// Dependency-free PDF for one Cash Flow Forecast period's full drill-down
// (AR collections by customer, AP payments by vendor, scheduled items and the
// run-rate composition). Uses the shared Courier primitives in ./pdfBuilder —
// no jspdf available in this environment.

import { PdfToken, ascii, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

// Portrait A4 (points).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 32;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 40;
const BODY_SIZE = 9;
const LINE_H = 12.5;

const PAGE_OPTS = { pageW: PAGE_W, pageH: PAGE_H, marginX: MARGIN_X, marginTop: MARGIN_TOP, lineH: LINE_H };
const MAX_LINES_PER_PAGE = Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LINE_H);

// Courier at 9pt is ~5.4pt/char; (595 - 2*32) / 5.4 ≈ 98 usable columns.
const NAME_W = 72;
const AMT_W = 20;

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs. ${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

function line(text: string, bold = false, size = BODY_SIZE): PdfToken {
  return { text: ascii(text), bold, size };
}

function amountRow(label: string, amount: string, bold = false): PdfToken {
  return line(padRight(label, NAME_W) + padLeft(amount, AMT_W), bold);
}

const BLANK = line("");
const RULE = line("-".repeat(NAME_W + AMT_W));

export interface PdfListRow {
  label: string;
  amount: number;
  /** prefix the amount with + / − to show direction */
  signed?: "in" | "out";
}

export interface CashFlowPeriodPdfOptions {
  periodLabel: string;
  intervalLabel: string;
  generatedOn: string;
  summary: { label: string; amount: number }[];
  closingLabel: string;
  closingAmount: number;
  arParties: PdfListRow[];
  apParties: PdfListRow[];
  schedItems: PdfListRow[];
  runOuts: PdfListRow[];
  runIns: PdfListRow[];
  footnotes: string[];
}

function fmtSigned(r: PdfListRow): string {
  if (r.signed === "in") return "+" + money(r.amount);
  if (r.signed === "out") return "-" + money(r.amount);
  return money(r.amount);
}

function section(tokens: PdfToken[], heading: string, rows: PdfListRow[], totalLabel: string) {
  tokens.push(BLANK, line(heading.toUpperCase(), true, 10));
  if (!rows.length) {
    tokens.push(line("  (none this period)"));
    return;
  }
  rows.forEach((r) => tokens.push(amountRow("  " + r.label, fmtSigned(r))));
  tokens.push(RULE);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  tokens.push(amountRow("  " + totalLabel, money(total), true));
}

export function buildCashFlowPeriodPdf(o: CashFlowPeriodPdfOptions): Blob {
  const tokens: PdfToken[] = [];

  tokens.push(line("CASH FLOW FORECAST", true, 14));
  tokens.push(line(`${o.intervalLabel} period: ${o.periodLabel}`, true, 11));
  tokens.push(line(`Generated ${o.generatedOn}`));
  tokens.push(BLANK, line("SUMMARY", true, 10));
  o.summary.forEach((s) => tokens.push(amountRow("  " + s.label, money(s.amount))));
  tokens.push(RULE);
  tokens.push(amountRow("  " + o.closingLabel, money(o.closingAmount), true));

  section(tokens, "AR collections by customer", o.arParties, "Total AR collections");
  section(tokens, "AP payments by vendor", o.apParties, "Total AP payments");
  section(tokens, "Scheduled items", o.schedItems, "Net scheduled");
  section(tokens, "Run-rate outflows by account", o.runOuts, "Total run-rate outflows");
  section(tokens, "Run-rate inflows by account", o.runIns, "Total run-rate inflows");

  if (o.footnotes.length) {
    tokens.push(BLANK);
    o.footnotes.forEach((f) => tokens.push(line(f, false, 7.5)));
  }

  // Paginate, repeating a small header on continuation pages.
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  tokens.forEach((t) => {
    if (page.length >= MAX_LINES_PER_PAGE) {
      pages.push(page);
      page = [line(`Cash Flow Forecast - ${o.periodLabel} (continued)`, true, 10), BLANK];
    }
    page.push(t);
  });
  if (page.length) pages.push(page);

  return renderTextPdf(pages, PAGE_OPTS);
}
