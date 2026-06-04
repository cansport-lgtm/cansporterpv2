// Minimal, dependency-free PDF generator for party/customer ledgers.
//
// The project's npm registry is locked down (no jspdf), so we emit a small but
// valid PDF by hand using only the PDF base-14 fonts. The body is rendered with
// Courier (a fixed-width font) so columns line up purely by character padding —
// no font-metric maths required. Output is plain ASCII, which keeps the byte
// offsets in the xref table identical to JS string offsets.

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

// Strip anything outside printable ASCII so the WinAnsi-encoded stream stays
// byte-for-byte equal to the JS string (keeps xref offsets correct).
function ascii(s: string): string {
  return (s ?? "")
    .replace(/[‒-―]/g, "-") // various dashes -> hyphen
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdf(s: string): string {
  return ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function padRight(s: string, n: number): string {
  const a = ascii(s);
  return a.length >= n ? a.slice(0, n) : a + " ".repeat(n - a.length);
}

function padLeft(s: string, n: number): string {
  const a = ascii(s);
  return a.length >= n ? a.slice(0, n) : " ".repeat(n - a.length) + a;
}

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

type Token = { text: string; bold: boolean; size: number };

// Build the ordered list of text lines for one page worth of content.
function buildPages(opts: LedgerPdfOptions): Token[][] {
  const usableBottom = MARGIN_BOTTOM;
  const startY = PAGE_H - MARGIN_TOP;

  const pages: Token[][] = [];
  let page: Token[] = [];
  let y = startY;

  const pushLine = (t: Token) => {
    page.push(t);
    y -= LINE_H;
  };
  const ensure = (needed: number, withHeader: boolean) => {
    if (y - needed < usableBottom) {
      pages.push(page);
      page = [];
      y = startY;
      if (withHeader) addTableHeader();
    }
  };

  const addTableHeader = () => {
    pushLine({ text: HEADER_LINE, bold: true, size: BODY_SIZE });
    pushLine({ text: "-".repeat(HEADER_LINE.length), bold: false, size: BODY_SIZE });
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

// Render one page's tokens into a PDF content stream.
function pageContent(tokens: Token[]): string {
  let y = PAGE_H - MARGIN_TOP;
  const parts: string[] = [];
  for (const t of tokens) {
    const font = t.bold ? "/F2" : "/F1";
    parts.push(
      `BT ${font} ${t.size} Tf ${MARGIN_X} ${y.toFixed(2)} Td (${escapePdf(t.text)}) Tj ET\n`
    );
    y -= LINE_H;
  }
  return parts.join("");
}

export function buildLedgerPdf(opts: LedgerPdfOptions): Blob {
  const pages = buildPages(opts);

  // Object layout:
  //   1 Catalog, 2 Pages, 3 Font(Courier), 4 Font(Courier-Bold),
  //   then per page: Page object + Content stream object.
  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`); // 1

  const pageObjNums: number[] = [];
  // Pages object (2) is filled in after we know kids; placeholder index reserved.
  objects.push(""); // 2 placeholder
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`); // 3
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`); // 4

  pages.forEach((tokens) => {
    const content = pageContent(tokens);
    const contentObjNum = objects.length + 1; // 1-based: current length + this push order
    // We push page object first, then content object, so reserve numbers:
    const pageObjNum = contentObjNum;
    const streamObjNum = contentObjNum + 1;
    pageObjNums.push(pageObjNum);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjNum} 0 R >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });

  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageObjNums.length} >>`;

  // Serialize with xref tracking.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets[i] = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n`;
  pdf += `0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}
