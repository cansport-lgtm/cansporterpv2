// Dependency-free PDF generator for domestic (customer) invoices.
// Uses the shared Courier-based primitives in ./pdfBuilder.

import { PdfToken, ascii, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

export interface InvoicePdfItem {
  description: string;
  details?: string;
  grade?: string;
  qty: string;
  rate: string;
  amount: string;
}

export interface InvoicePdfOptions {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTerms?: string;
  status?: string;
  customerName: string;
  customerCode?: string;
  dispatchNumber?: string;
  items: InvoicePdfItem[];
  totalQty: string;
  /** Sum of line items before discount. Only shown when a discount is present. */
  subtotal?: string;
  /** Discount amount. The subtotal/discount lines are only printed when this is set. */
  discount?: string;
  totalAmount: string;
  notes?: string;
  generatedOn?: string;
}

// Portrait A4 (points).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 32;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 40;

const BODY_SIZE = 9;
const LINE_H = 12.5;

// Fixed character widths per column (Courier is monospaced).
const COLS = { idx: 3, product: 34, grade: 16, qty: 8, rate: 12, amount: 13 };

function itemLine(idx: string, product: string, grade: string, qty: string, rate: string, amount: string): string {
  return (
    padRight(idx, COLS.idx) + " " +
    padRight(product, COLS.product) + " " +
    padRight(grade, COLS.grade) + " " +
    padLeft(qty, COLS.qty) + " " +
    padLeft(rate, COLS.rate) + " " +
    padLeft(amount, COLS.amount)
  );
}

const HEADER_LINE = itemLine("#", "Product", "Grade / Packing", "Qty", "Rate/Dz", "Amount");

function buildPages(opts: InvoicePdfOptions): PdfToken[][] {
  const usableBottom = MARGIN_BOTTOM;
  const startY = PAGE_H - MARGIN_TOP;

  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  let y = startY;

  const pushLine = (t: PdfToken) => {
    page.push(t);
    y -= LINE_H;
  };
  const addTableHeader = () => {
    pushLine({ text: HEADER_LINE, bold: true, size: BODY_SIZE });
    pushLine({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
  };
  const ensure = (needed: number, withHeader: boolean) => {
    if (y - needed < usableBottom) {
      pages.push(page);
      page = [];
      y = startY;
      if (withHeader) addTableHeader();
    }
  };

  // --- Heading ---
  pushLine({ text: "INVOICE", bold: true, size: 16 });
  y -= 4;
  pushLine({ text: `No: ${opts.invoiceNumber}`, bold: true, size: 10 });
  pushLine({ text: `Date: ${opts.invoiceDate}`, bold: false, size: 9 });
  // Due date and payment terms intentionally not printed on the customer invoice.
  if (opts.status) pushLine({ text: `Status: ${opts.status}`, bold: false, size: 9 });
  y -= 6;

  // --- Bill to ---
  pushLine({ text: "BILL TO", bold: true, size: 9 });
  pushLine({
    text: opts.customerName + (opts.customerCode ? `  [${opts.customerCode}]` : ""),
    bold: true,
    size: 10,
  });
  if (opts.dispatchNumber) pushLine({ text: `Dispatch ref: ${opts.dispatchNumber}`, bold: false, size: 9 });
  y -= 6;

  addTableHeader();

  if (!opts.items.length) {
    pushLine({ text: "  No line items.", bold: false, size: BODY_SIZE });
  }

  opts.items.forEach((it, i) => {
    ensure(LINE_H, true);
    pushLine({
      text: itemLine(String(i + 1), it.description, it.grade || "", it.qty, it.rate, it.amount),
      bold: false,
      size: BODY_SIZE,
    });
    if (it.details) {
      // Indent the details sub-line under the product column; wrap to the full
      // table width so long descriptions are not truncated.
      const indent = " ".repeat(COLS.idx + 1);
      const detailWidth = HEADER_LINE.length - (COLS.idx + 1);
      for (const chunk of wrap(ascii(it.details), detailWidth)) {
        ensure(LINE_H, true);
        pushLine({ text: indent + chunk, bold: false, size: 8 });
      }
    }
  });

  // Totals
  const hasDiscount = !!opts.discount;
  ensure(LINE_H * (hasDiscount ? 4 : 2), true);
  pushLine({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
  if (hasDiscount) {
    pushLine({
      text: itemLine("", "Subtotal", "", "", "", opts.subtotal || opts.totalAmount),
      bold: false,
      size: BODY_SIZE,
    });
    pushLine({
      text: itemLine("", "Discount", "", "", "", `- ${opts.discount}`),
      bold: false,
      size: BODY_SIZE,
    });
  }
  pushLine({
    text: itemLine("", "TOTAL", "", opts.totalQty, "", opts.totalAmount),
    bold: true,
    size: BODY_SIZE,
  });

  if (opts.notes) {
    y -= 6;
    ensure(LINE_H * 2, false);
    pushLine({ text: "NOTES", bold: true, size: 9 });
    // Wrap notes to the page width (~ chars per Courier line).
    const maxChars = HEADER_LINE.length;
    for (const chunk of wrap(ascii(opts.notes), maxChars)) {
      ensure(LINE_H, false);
      pushLine({ text: chunk, bold: false, size: 9 });
    }
  }

  if (opts.generatedOn) {
    ensure(LINE_H * 2, false);
    y -= 6;
    pushLine({ text: `Generated: ${opts.generatedOn}`, bold: false, size: 8 });
  }

  pages.push(page);
  return pages;
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line.length) {
      line = w;
    } else if ((line + " " + w).length <= maxChars) {
      line += " " + w;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [""];
}

export function buildInvoicePdf(opts: InvoicePdfOptions): Blob {
  return renderTextPdf(buildPages(opts), {
    pageW: PAGE_W,
    pageH: PAGE_H,
    marginX: MARGIN_X,
    marginTop: MARGIN_TOP,
    lineH: LINE_H,
  });
}
