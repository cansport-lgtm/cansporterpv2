// Dependency-free PDF generator for the distributor dispatch sheet.
// Uses the shared Courier-based primitives in ./pdfBuilder.

import { PdfToken, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

export interface DispatchSheetPdfRow {
  product: string;
  unit: string;
  quantity: string;
  orders: string;
  distributors: string;
}

export interface DispatchSheetPdfOptions {
  scopeName: string;
  period?: string;
  generatedOn?: string;
  isAll: boolean;
  rows: DispatchSheetPdfRow[];
  totalQty: string;
  totalOrders: string;
}

// Portrait A4 (points).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 36;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;

const BODY_SIZE = 9;
const LINE_H = 12.5;

// Fixed character widths per column (Courier is monospaced). The Distributors
// column is only rendered in the company-wide ("All Distributors") view.
const COLS = { product: 46, unit: 8, qty: 12, orders: 8, distributors: 13 };

function rowToLine(r: DispatchSheetPdfRow, isAll: boolean): string {
  let line =
    padRight(r.product, COLS.product) + " " +
    padRight(r.unit, COLS.unit) + " " +
    padLeft(r.quantity, COLS.qty) + " " +
    padLeft(r.orders, COLS.orders);
  if (isAll) line += " " + padLeft(r.distributors, COLS.distributors);
  return line;
}

function buildPages(opts: DispatchSheetPdfOptions): PdfToken[][] {
  const usableBottom = MARGIN_BOTTOM;
  const startY = PAGE_H - MARGIN_TOP;

  const headerLine = rowToLine(
    { product: "Product", unit: "Unit", quantity: "Total Qty", orders: "Orders", distributors: "Distributors" },
    opts.isAll
  );

  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  let y = startY;

  const pushLine = (t: PdfToken) => {
    page.push(t);
    y -= LINE_H;
  };
  const addTableHeader = () => {
    pushLine({ text: headerLine, bold: true, size: BODY_SIZE });
    pushLine({ text: "-".repeat(headerLine.length), bold: false, size: BODY_SIZE });
  };
  const ensure = (needed: number) => {
    if (y - needed < usableBottom) {
      pages.push(page);
      page = [];
      y = startY;
      addTableHeader();
    }
  };

  // --- Heading block ---
  pushLine({ text: "Dispatch Sheet", bold: true, size: 14 });
  y -= 4;
  pushLine({ text: opts.scopeName, bold: true, size: 10 });
  if (opts.period) pushLine({ text: `Requirements from approved orders: ${opts.period}`, bold: false, size: 9 });
  else pushLine({ text: "Requirements from approved orders", bold: false, size: 9 });
  if (opts.generatedOn) pushLine({ text: `Generated: ${opts.generatedOn}`, bold: false, size: 9 });
  y -= 6;

  addTableHeader();

  if (!opts.rows.length) {
    pushLine({ text: "  No approved orders awaiting dispatch.", bold: false, size: BODY_SIZE });
  }

  for (const r of opts.rows) {
    ensure(LINE_H);
    pushLine({ text: rowToLine(r, opts.isAll), bold: false, size: BODY_SIZE });
  }

  // Totals
  ensure(LINE_H * 2);
  pushLine({ text: "-".repeat(headerLine.length), bold: false, size: BODY_SIZE });
  pushLine({
    text: rowToLine(
      { product: "TOTAL", unit: "", quantity: opts.totalQty, orders: opts.totalOrders, distributors: "" },
      opts.isAll
    ),
    bold: true,
    size: BODY_SIZE,
  });

  pages.push(page);
  return pages;
}

export function buildDispatchSheetPdf(opts: DispatchSheetPdfOptions): Blob {
  return renderTextPdf(buildPages(opts), {
    pageW: PAGE_W,
    pageH: PAGE_H,
    marginX: MARGIN_X,
    marginTop: MARGIN_TOP,
    lineH: LINE_H,
  });
}
