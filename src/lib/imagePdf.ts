// Build a single-page PDF that embeds one JPEG image, sized to A4 width.
//
// The npm registry is locked down (no jspdf), and the shared text-PDF builder is
// ASCII-only — it cannot render Urdu. Rendering the report to a <canvas> and
// embedding it as a JPEG keeps full Unicode (Urdu) fidelity while still
// producing a real, shareable PDF.

const A4_WIDTH_PT = 595.28; // A4 width in PDF points

function latin1Bytes(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

/** Decode a `data:image/jpeg;base64,...` URL into raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Wrap a JPEG (raw bytes + pixel dimensions) into a one-page PDF whose page is
 * A4-wide and proportionally tall.
 */
export function jpegToPdf(jpeg: Uint8Array, imgW: number, imgH: number): Blob {
  const pageW = A4_WIDTH_PT;
  const pageH = +(A4_WIDTH_PT * (imgH / imgW)).toFixed(2);

  const chunks: Uint8Array[] = [];
  let len = 0;
  const offsets: number[] = [];
  const pushBytes = (u: Uint8Array) => { chunks.push(u); len += u.length; };
  const pushStr = (s: string) => pushBytes(latin1Bytes(s));
  const startObj = (n: number) => { offsets[n] = len; };

  pushStr("%PDF-1.4\n");

  startObj(1);
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObj(2);
  pushStr("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  startObj(3);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );

  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  startObj(4);
  pushStr(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  startObj(5);
  pushStr(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  pushBytes(jpeg);
  pushStr("\nendstream\nendobj\n");

  const xrefStart = len;
  const count = 6; // objects 0..5
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  pushStr(xref);
  pushStr(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return new Blob([out], { type: "application/pdf" });
}
