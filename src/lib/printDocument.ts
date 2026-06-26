/**
 * Robust browser printing via a hidden same-origin iframe.
 *
 * The previous approach overlaid a `hidden print:block print:fixed` element on top of
 * the live app and called `window.print()`. That is fragile: on mobile / standalone
 * PWAs `window.print()` can fire before the overlay paints, or the React state that
 * controls the overlay unmounts it mid-print, producing a BLANK page. Writing the
 * document into an isolated iframe with its own inline CSS removes every one of those
 * failure modes — the print contains exactly what we wrote, nothing from the app shell.
 */

/** Escape a value for safe interpolation into HTML text/attributes. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared print stylesheet for dispatch documents (plain CSS — no Tailwind dependency). */
export const DISPATCH_PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; padding: 24px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 16px; }
  .head .brand { display: flex; align-items: center; gap: 10px; }
  .head img { height: 44px; width: auto; }
  .head h1 { font-size: 20px; margin: 0; line-height: 1.1; }
  .muted { color: #666; }
  .xs { font-size: 10px; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .grid2 { display: flex; gap: 24px; margin-bottom: 16px; }
  .grid2 > div { flex: 1; }
  .label { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 2px solid #222; padding: 6px 4px; font-size: 11px; }
  td { padding: 5px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th.num, td.num { text-align: right; }
  tfoot td { border-top: 2px solid #222; border-bottom: none; font-weight: 700; }
  .section-title { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 700; margin: 16px 0 6px; }
  .order-card { border: 1px solid #ccc; border-radius: 4px; margin-bottom: 12px; page-break-inside: avoid; }
  .order-card .bar { background: #f1f1f1; padding: 6px 10px; font-weight: 700; display: flex; justify-content: space-between; }
  .order-card table td, .order-card table th { padding-left: 10px; padding-right: 10px; }
  .status { text-transform: uppercase; font-size: 10px; font-weight: 700; }
  .sign { display: flex; gap: 32px; margin-top: 48px; }
  .sign > div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 10px; color: #555; }
  @page { margin: 14mm; }
`;

/**
 * Write `bodyHtml` into a hidden iframe and print it. Waits for any images to finish
 * loading (with a timeout fallback) so logos don't print blank, then cleans up.
 */
export function printDocument(title: string, bodyHtml: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>${DISPATCH_PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`
  );
  doc.close();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Give the print dialog a beat to grab the frame before removing it.
    setTimeout(() => iframe.remove(), 1000);
  };

  const fire = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
    // Fallback cleanup in case onafterprint never fires (some mobile browsers).
    setTimeout(cleanup, 60000);
  };

  // Wait for images (logo) so they don't print blank; fall back after 1.5s.
  const images = Array.from(doc.images);
  if (images.length === 0) {
    setTimeout(fire, 50);
    return;
  }
  let pending = images.length;
  const settle = () => {
    pending -= 1;
    if (pending <= 0) fire();
  };
  images.forEach((img) => {
    if (img.complete) settle();
    else {
      img.onload = settle;
      img.onerror = settle;
    }
  });
  setTimeout(() => {
    if (!done) fire();
  }, 1500);
}
