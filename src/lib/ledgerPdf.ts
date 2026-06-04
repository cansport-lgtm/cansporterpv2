// Dependency-free PDF generator for party/customer ledgers.
// Uses the shared Courier-based primitives in ./pdfBuilder.

import { PdfToken, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

export interface LedgerPdfRow {
  date: string;
  voucher: string;
  against: string;
  narration: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface LedgerPdfOptions {
  title: string;
  partyName: string;
  partyCode?: string;
  partyType?: string;
  period: string;
  opening: string;
  rows: LedgerPdfRow[];
  totalDr: string;
  totalCr: string;
  closing: string;
  generatedOn?: string;
}

// Landscape A4 (points).
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN_X = 28;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 34;

const BODY_SIZE = 9;
const LINE_H = 12.5;

// Fixed character widths per column (Courier is monospaced).
const COLS = { date: 11, voucher: 18, against: 18, narr: 40, debit: 13, credit: 13, balance: 16 };

function rowToLine(r: LedgerPdfRow): string {
  return (
    padRight(r.date, COLS.date) + " " +
    padRight(r.voucher, COLS.voucher) + " " +
    padRight(r.against, COLS.against) + " " +
    padRight(r.narration, COLS.narr) + " " +
    padLeft(r.debit, COLS.debit) + " " +
    padLeft(r.credit, COLS.credit) + " " +
    padLeft(r.balance, COLS.balance)
  );
}

const HEADER_LINE = rowToLine({
  date: "Date",
  voucher: "Voucher",
  against: "Against A/c",
  narration: "Narration",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
});

// Build the ordered list of text lines for each page.
function buildPages(opts: LedgerPdfOptions): PdfToken[][] {
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

  // --- First page heading block ---
  pushLine({ text: opts.title, bold: true, size: 14 });
  y -= 4;
  const metaParts = [opts.partyName];
  if (opts.partyCode) metaParts.push(`[${opts.partyCode}]`);
  if (opts.partyType) metaParts.push(`(${opts.partyType})`);
  pushLine({ text: metaParts.join("  "), bold: true, size: 10 });
  pushLine({ text: `Period: ${opts.period}`, bold: false, size: 9 });
  if (opts.generatedOn) pushLine({ text: `Generated: ${opts.generatedOn}`, bold: false, size: 9 });
  y -= 6;

  addTableHeader();

  // Opening balance row
  pushLine({
    text: rowToLine({
      date: "", voucher: "Opening Balance", against: "", narration: "",
      debit: "", credit: "", balance: opts.opening,
    }),
    bold: false,
    size: BODY_SIZE,
  });

  if (!opts.rows.length) {
    pushLine({ text: "  No transactions in this period.", bold: false, size: BODY_SIZE });
  }

  for (const r of opts.rows) {
    ensure(LINE_H, true);
    pushLine({ text: rowToLine(r), bold: false, size: BODY_SIZE });
  }

  // Totals / closing
  ensure(LINE_H * 2, true);
  pushLine({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
  pushLine({
    text: rowToLine({
      date: "", voucher: "Total / Closing", against: "", narration: "",
      debit: opts.totalDr, credit: opts.totalCr, balance: opts.closing,
    }),
    bold: true,
    size: BODY_SIZE,
  });

  pages.push(page);
  return pages;
}

export function buildLedgerPdf(opts: LedgerPdfOptions): Blob {
  return renderTextPdf(buildPages(opts), {
    pageW: PAGE_W,
    pageH: PAGE_H,
    marginX: MARGIN_X,
    marginTop: MARGIN_TOP,
    lineH: LINE_H,
  });
}
