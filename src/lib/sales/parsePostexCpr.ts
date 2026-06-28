// Parse a PostEx "Cash Payment Receipt" (CPR) PDF in the browser.
//
// PostEx exports CPRs as PDF only. We don't need a heavy PDF library: the text
// lives in FlateDecode streams as parenthesised string operands, which we
// inflate with the browser's DecompressionStream and read out. Per parcel we
// only extract tracking #, status, shipping and COD — net/GST/WHT are then
// computed with PostEx's (verified) formula, avoiding fragile column parsing.

export interface CprParsed { cpr: string; date: string; rows: { tracking: string; status: "delivered" | "returned"; shipping: number; cod: number }[]; }

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  for (const fmt of ["deflate", "deflate-raw", "gzip"] as const) {
    try {
      const ds = new (globalThis as any).DecompressionStream(fmt);
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(buf);
    } catch { /* try next format */ }
  }
  return bytes; // not compressed
}

const isNum = (t: string) => /\d/.test(t) && /^\(?-?[\d,]+\.?\d*\)?$/.test(t.trim());
const num = (t: string) => parseFloat(t.replace(/[(),\s]/g, "")) || 0;

export async function parsePostexCprPdf(buf: ArrayBuffer): Promise<CprParsed> {
  const u8 = new Uint8Array(buf);
  const latin = new TextDecoder("latin1").decode(u8);

  // Collect text from every (possibly compressed) content stream.
  const texts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    const chunk = u8.slice(start, end);
    try { texts.push(new TextDecoder("latin1").decode(await inflate(chunk))); } catch { /* skip */ }
  }
  const full = texts.join("\n");

  // Pull out parenthesised PDF text operands.
  const tokens: string[] = [];
  const tre = /\(((?:\\.|[^()\\])*)\)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tre.exec(full))) tokens.push(tm[1].replace(/\\([()\\])/g, "$1").trim());

  const cpr = (full.match(/CPR-[A-Z0-9]+/) || [""])[0] || "";
  let date = "";
  const dtok = tokens.find(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
  if (dtok) { const [d, mo, y] = dtok.split("/"); date = `${y}-${mo}-${d}`; }

  const rows: CprParsed["rows"] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d{12,16}$/.test(tokens[i])) continue;           // a tracking number
    const tracking = tokens[i];
    let j = i + 1, status: "delivered" | "returned" | "" = "";
    for (; j < Math.min(i + 8, tokens.length); j++) {
      if (/^delivered$/i.test(tokens[j])) { status = "delivered"; break; }
      if (/^return(ed)?$/i.test(tokens[j])) { status = "returned"; break; }
    }
    if (!status) continue;
    const nums: number[] = [];                               // shipping, then COD
    for (let k = j + 1; k < Math.min(j + 6, tokens.length) && nums.length < 2; k++) {
      if (isNum(tokens[k])) nums.push(num(tokens[k]));
    }
    if (nums.length < 2 || seen.has(tracking)) continue;
    seen.add(tracking);
    rows.push({ tracking, status, shipping: nums[0], cod: nums[1] });
  }

  return { cpr, date, rows };
}
