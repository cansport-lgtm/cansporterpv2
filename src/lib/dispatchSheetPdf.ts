// Dependency-free PDF generators for distributor dispatch sheets.
// Uses the shared Courier-based primitives in ./pdfBuilder (no jspdf available).
// Mirrors ./invoicePdf so WhatsApp/PDF sharing is consistent across the app.

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

function wrap(text: string, maxChars: number): string[] {
  const words = ascii(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line.length) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// Per-order Dispatch Sheet
// ---------------------------------------------------------------------------

export interface DispatchSheetItem {
  product: string;
  sku?: string;
  unit: string;
  ordered: string;
  dispatched: string;
  remarks?: string;
}

export interface DispatchSheetOptions {
  orderNumber: string;
  orderDate: string;
  requiredDate?: string;
  dispatchedDate?: string;
  status?: string;
  distributorName: string;
  distributorCode?: string;
  distributorAddress?: string;
  distributorPhone?: string;
  customerName: string;
  customerCode?: string;
  customerAddress?: string;
  customerContact?: string;
  customerPhone?: string;
  items: DispatchSheetItem[];
  totalOrdered: string;
  totalDispatched: string;
  notes?: string;
  generatedOn?: string;
}

const COLS = { idx: 3, product: 32, unit: 7, ordered: 9, dispatched: 11, remarks: 18 };

function itemLine(idx: string, product: string, unit: string, ordered: string, dispatched: string, remarks: string): string {
  return (
    padRight(idx, COLS.idx) + " " +
    padRight(product, COLS.product) + " " +
    padRight(unit, COLS.unit) + " " +
    padLeft(ordered, COLS.ordered) + " " +
    padLeft(dispatched, COLS.dispatched) + " " +
    padRight(remarks, COLS.remarks)
  );
}

const HEADER_LINE = itemLine("#", "Product", "Unit", "Ordered", "Dispatchd", "Remarks");

function buildDispatchPages(opts: DispatchSheetOptions): PdfToken[][] {
  const startY = PAGE_H - MARGIN_TOP;
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  let y = startY;

  const push = (t: PdfToken) => {
    page.push(t);
    y -= LINE_H;
  };
  const addTableHeader = () => {
    push({ text: HEADER_LINE, bold: true, size: BODY_SIZE });
    push({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
  };
  const ensure = (needed: number, withHeader: boolean) => {
    if (y - needed < MARGIN_BOTTOM) {
      pages.push(page);
      page = [];
      y = startY;
      if (withHeader) addTableHeader();
    }
  };

  // Heading
  push({ text: "DISPATCH SHEET", bold: true, size: 16 });
  y -= 2;
  push({ text: "Delivery / Picking Slip", bold: false, size: 8 });
  push({ text: `No: ${opts.orderNumber}`, bold: true, size: 10 });
  push({ text: `Order date: ${opts.orderDate}`, bold: false, size: 9 });
  if (opts.requiredDate) push({ text: `Required: ${opts.requiredDate}`, bold: false, size: 9 });
  if (opts.dispatchedDate) push({ text: `Dispatched: ${opts.dispatchedDate}`, bold: false, size: 9 });
  if (opts.status) push({ text: `Status: ${opts.status.toUpperCase()}`, bold: false, size: 9 });
  y -= 6;

  // Distributor / Deliver to
  push({ text: "DISTRIBUTOR", bold: true, size: 9 });
  push({ text: opts.distributorName + (opts.distributorCode ? `  [${opts.distributorCode}]` : ""), bold: true, size: 10 });
  if (opts.distributorAddress) for (const c of wrap(opts.distributorAddress, HEADER_LINE.length)) push({ text: c, bold: false, size: 8 });
  if (opts.distributorPhone) push({ text: `Ph: ${opts.distributorPhone}`, bold: false, size: 8 });
  y -= 4;
  push({ text: "DELIVER TO", bold: true, size: 9 });
  push({ text: opts.customerName + (opts.customerCode ? `  [${opts.customerCode}]` : ""), bold: true, size: 10 });
  if (opts.customerAddress) for (const c of wrap(opts.customerAddress, HEADER_LINE.length)) push({ text: c, bold: false, size: 8 });
  if (opts.customerContact) push({ text: `Attn: ${opts.customerContact}`, bold: false, size: 8 });
  if (opts.customerPhone) push({ text: `Ph: ${opts.customerPhone}`, bold: false, size: 8 });
  y -= 6;

  addTableHeader();
  if (!opts.items.length) push({ text: "  No line items.", bold: false, size: BODY_SIZE });

  opts.items.forEach((it, i) => {
    ensure(LINE_H, true);
    push({
      text: itemLine(String(i + 1), it.sku ? `${it.product} [${it.sku}]` : it.product, it.unit, it.ordered, it.dispatched, it.remarks || ""),
      bold: false,
      size: BODY_SIZE,
    });
  });

  ensure(LINE_H * 2, true);
  push({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
  push({ text: itemLine("", "TOTAL", "", opts.totalOrdered, opts.totalDispatched, ""), bold: true, size: BODY_SIZE });

  if (opts.notes) {
    y -= 6;
    ensure(LINE_H * 2, false);
    push({ text: "NOTES", bold: true, size: 9 });
    for (const c of wrap(opts.notes, HEADER_LINE.length)) {
      ensure(LINE_H, false);
      push({ text: c, bold: false, size: 9 });
    }
  }

  y -= 10;
  ensure(LINE_H * 2, false);
  push({ text: padRight("Prepared By", 28) + padRight("Dispatched By", 28) + "Received By", bold: false, size: 9 });

  if (opts.generatedOn) {
    ensure(LINE_H, false);
    push({ text: `Generated: ${opts.generatedOn}`, bold: false, size: 8 });
  }

  pages.push(page);
  return pages;
}

export function buildDispatchSheetPdf(opts: DispatchSheetOptions): Blob {
  return renderTextPdf(buildDispatchPages(opts), PAGE_OPTS);
}

// ---------------------------------------------------------------------------
// Consolidated / bulk Dispatch Sheet (multiple orders)
// ---------------------------------------------------------------------------

export interface BulkPickRow {
  product: string;
  unit: string;
  quantity: string;
}

export interface BulkOrderGroup {
  orderNumber: string;
  customer: string;
  distributor?: string; // shown when scope is "all"
  when: string;
  items: { product: string; unit: string; quantity: string }[];
}

export interface BulkDispatchSheetOptions {
  scopeLabel: string;
  printedOn: string;
  pickList: BulkPickRow[];
  orders: BulkOrderGroup[];
  totalUnits: string;
}

const PCOLS = { product: 46, unit: 8, qty: 12 };
function pickLine(product: string, unit: string, qty: string): string {
  return padRight(product, PCOLS.product) + " " + padRight(unit, PCOLS.unit) + " " + padLeft(qty, PCOLS.qty);
}
const PICK_HEADER = pickLine("Product", "Unit", "Total Qty");

function buildBulkPages(opts: BulkDispatchSheetOptions): PdfToken[][] {
  const startY = PAGE_H - MARGIN_TOP;
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  let y = startY;

  const push = (t: PdfToken) => {
    page.push(t);
    y -= LINE_H;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN_BOTTOM) {
      pages.push(page);
      page = [];
      y = startY;
    }
  };

  push({ text: "DISPATCH SHEET", bold: true, size: 16 });
  y -= 2;
  push({ text: "Consolidated - approved orders awaiting dispatch", bold: false, size: 8 });
  push({ text: opts.scopeLabel, bold: true, size: 10 });
  push({ text: `Printed: ${opts.printedOn}   Orders: ${opts.orders.length}`, bold: false, size: 9 });
  y -= 6;

  if (!opts.orders.length) {
    push({ text: "No approved orders awaiting dispatch.", bold: false, size: 9 });
    pages.push(page);
    return pages;
  }

  // Pick list
  push({ text: "PICK LIST (total to pull from stock)", bold: true, size: 9 });
  push({ text: PICK_HEADER, bold: true, size: BODY_SIZE });
  push({ text: "-".repeat(PICK_HEADER.length), bold: false, size: BODY_SIZE });
  opts.pickList.forEach((r) => {
    ensure(LINE_H);
    push({ text: pickLine(r.product, r.unit, r.quantity), bold: false, size: BODY_SIZE });
  });
  ensure(LINE_H);
  push({ text: "-".repeat(PICK_HEADER.length), bold: false, size: BODY_SIZE });
  push({ text: pickLine("TOTAL", "", opts.totalUnits), bold: true, size: BODY_SIZE });
  y -= 8;

  // Per-order breakdown
  ensure(LINE_H * 2);
  push({ text: "PER-ORDER BREAKDOWN", bold: true, size: 9 });
  opts.orders.forEach((o) => {
    ensure(LINE_H * 3);
    const head = `${o.orderNumber} - ${o.customer}` + (o.distributor ? ` (${o.distributor})` : "");
    push({ text: head, bold: true, size: 9 });
    push({ text: o.when, bold: false, size: 8 });
    push({ text: pickLine("Product", "Unit", "Qty"), bold: true, size: BODY_SIZE });
    o.items.forEach((it) => {
      ensure(LINE_H);
      push({ text: pickLine(it.product, it.unit, it.quantity), bold: false, size: BODY_SIZE });
    });
    y -= 6;
  });

  pages.push(page);
  return pages;
}

export function buildBulkDispatchSheetPdf(opts: BulkDispatchSheetOptions): Blob {
  return renderTextPdf(buildBulkPages(opts), PAGE_OPTS);
}
