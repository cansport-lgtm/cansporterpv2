// Shared, dependency-free PDF primitives.
//
// The npm registry is locked down (no jspdf), so we emit small but valid PDFs by
// hand using only the PDF base-14 fonts. Bodies are rendered with Courier (a
// fixed-width font) so columns line up purely by character padding. Output is
// plain ASCII, which keeps the byte offsets in the xref table identical to JS
// string offsets.

export interface PdfToken {
  text: string;
  bold: boolean;
  size: number;
}

export interface PdfPageOptions {
  pageW: number;
  pageH: number;
  marginX: number;
  marginTop: number;
  lineH: number;
}

// Strip anything outside printable ASCII so the WinAnsi-encoded stream stays
// byte-for-byte equal to the JS string (keeps xref offsets correct).
export function ascii(s: string): string {
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

export function padRight(s: string, n: number): string {
  const a = ascii(s);
  return a.length >= n ? a.slice(0, n) : a + " ".repeat(n - a.length);
}

export function padLeft(s: string, n: number): string {
  const a = ascii(s);
  return a.length >= n ? a.slice(0, n) : " ".repeat(n - a.length) + a;
}

// Render one page's tokens (laid out top-down at a fixed line height) into a PDF
// content stream.
function pageContent(tokens: PdfToken[], opts: PdfPageOptions): string {
  let y = opts.pageH - opts.marginTop;
  const parts: string[] = [];
  for (const t of tokens) {
    const font = t.bold ? "/F2" : "/F1";
    parts.push(
      `BT ${font} ${t.size} Tf ${opts.marginX} ${y.toFixed(2)} Td (${escapePdf(t.text)}) Tj ET\n`
    );
    y -= opts.lineH;
  }
  return parts.join("");
}

// Assemble a complete PDF from pre-laid-out pages of text tokens.
export function renderTextPdf(pages: PdfToken[][], opts: PdfPageOptions): Blob {
  // Object layout:
  //   1 Catalog, 2 Pages, 3 Font(Courier), 4 Font(Courier-Bold),
  //   then per page: Page object + Content stream object.
  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`); // 1
  objects.push(""); // 2 placeholder (filled once kids are known)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`); // 3
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`); // 4

  const pageObjNums: number[] = [];
  pages.forEach((tokens) => {
    const content = pageContent(tokens, opts);
    const pageObjNum = objects.length + 1;
    const streamObjNum = pageObjNum + 1;
    pageObjNums.push(pageObjNum);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${opts.pageW} ${opts.pageH}] ` +
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
