// Print the Periodic COGS calculation — summary only, or full report with
// every stock-closing row and voucher used in the calculation. Uses the
// shared hidden-iframe printer so it works on mobile / PWA like the
// voucher and dispatch prints.

import { format, parseISO } from "date-fns";
import { printDocument, esc } from "@/lib/printDocument";
import type {
  PeriodicCOGSPreview,
  PeriodicCOGSDetails,
  PeriodicCOGSStockRow,
  PeriodicCOGSVoucherRow,
} from "./postPeriodicCOGS";

const rs = (n: number) => `Rs. ${Number(n || 0).toLocaleString()}`;
const fmtDate = (d: string) => {
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
};

function stockTable(title: string, note: string, rows: PeriodicCOGSStockRow[]): string {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const body = rows.length
    ? rows
        .map(
          (r) => `
            <tr>
              <td style="font-family: monospace;">${esc(r.code)}</td>
              <td>${esc(r.name)}${r.rate === 0 ? ' <span class="muted xs">(no cost set)</span>' : ""}</td>
              <td>${esc(fmtDate(r.closing_date))}</td>
              <td class="num">${esc(r.qty.toLocaleString())}${r.unit ? ` ${esc(r.unit)}` : ""}</td>
              <td class="num">${esc(r.rate.toLocaleString())}</td>
              <td class="num">${esc(r.value.toLocaleString())}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No stock rows in this closing.</td></tr>`;

  return `
    <div class="section-title">${esc(title)}</div>
    <div class="muted xs" style="margin-bottom: 4px;">${esc(note)}</div>
    <table>
      <thead>
        <tr>
          <th>Code</th><th>Item</th><th>Closing Date</th>
          <th class="num">Qty</th><th class="num">Rate (Rs.)</th><th class="num">Value (Rs.)</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <td colspan="5">Total (${rows.length} items)</td>
          <td class="num">${esc(total.toLocaleString())}</td>
        </tr>
      </tfoot>
    </table>`;
}

function voucherTable(title: string, note: string, rows: PeriodicCOGSVoucherRow[], amountLabel: string): string {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const body = rows.length
    ? rows
        .map(
          (r) => `
            <tr>
              <td style="white-space: nowrap;">${esc(r.voucher_number)}</td>
              <td style="white-space: nowrap;">${esc(fmtDate(r.voucher_date))}</td>
              <td>${esc(r.source_module || "manual")}</td>
              <td class="muted">${esc(r.narration || "—")}</td>
              <td class="num">${esc(r.amount.toLocaleString())}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No vouchers in this period.</td></tr>`;

  return `
    <div class="section-title">${esc(title)}</div>
    <div class="muted xs" style="margin-bottom: 4px;">${esc(note)}</div>
    <table>
      <thead>
        <tr>
          <th>Voucher #</th><th>Date</th><th>Source</th><th>Narration</th>
          <th class="num">${esc(amountLabel)}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">Total (${rows.length} vouchers)</td>
          <td class="num">${esc(total.toLocaleString())}</td>
        </tr>
      </tfoot>
    </table>`;
}

function summaryHtml(p: PeriodicCOGSPreview): string {
  const varianceNote =
    Math.abs(p.variance) < 0.01
      ? "GL already matches the periodic value — no adjustment needed."
      : p.variance > 0
        ? "GL under-recognized — this much COGS still needs to be added."
        : "GL over-recognized — this much COGS needs to be reversed.";

  return `
    <div class="head">
      <div class="brand">
        <div>
          <h1>Periodic COGS (Stock-Based)</h1>
          <div class="muted xs">COGS = (Previous Closing + RM Purchases) − Current Closing</div>
        </div>
      </div>
      <div class="right">
        <div class="label">Period</div>
        <div class="bold">${esc(fmtDate(p.fromDate))} — ${esc(fmtDate(p.toDate))}</div>
        <div class="muted xs">Printed ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}</div>
      </div>
    </div>

    <div class="section-title">Calculation</div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th class="num">Raw Material</th>
          <th class="num">FG + WIP</th>
          <th class="num">Total Inventory</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Previous Closing <span class="muted xs">(before ${esc(fmtDate(p.fromDate))})</span></td>
          <td class="num">${esc(rs(p.previousRMValue))} <span class="muted xs">(${p.itemCounts.previousRM} items)</span></td>
          <td class="num">${esc(rs(p.previousFGWIPValue))} <span class="muted xs">(${p.itemCounts.previousFGWIP} items)</span></td>
          <td class="num bold">${esc(rs(p.previousTotalInventory))}</td>
        </tr>
        <tr>
          <td>+ Net RM Purchases <span class="muted xs">(this period)</span></td>
          <td class="num">+ ${esc(rs(p.rmPurchasesValue))}</td>
          <td class="num muted">—</td>
          <td class="num bold">+ ${esc(rs(p.rmPurchasesValue))}</td>
        </tr>
        <tr>
          <td>− Current Closing <span class="muted xs">(in period)</span></td>
          <td class="num">${esc(rs(p.currentRMValue))} <span class="muted xs">(${p.itemCounts.currentRM} items)</span></td>
          <td class="num">${esc(rs(p.currentFGWIPValue))} <span class="muted xs">(${p.itemCounts.currentFGWIP} items)</span></td>
          <td class="num bold">− ${esc(rs(p.currentTotalInventory))}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">COGS = (Previous + Purchases) − Current</td>
          <td class="num">${esc(rs(p.calculatedCOGS))}</td>
        </tr>
      </tfoot>
    </table>

    <div class="section-title">Reconciliation to GL</div>
    <table>
      <tbody>
        <tr>
          <td>Periodic COGS (calculated above)</td>
          <td class="num bold">${esc(rs(p.calculatedCOGS))}</td>
        </tr>
        <tr>
          <td>Already posted COGS in this period <span class="muted xs">(per-dispatch COGS + prior periodic adjustments)</span></td>
          <td class="num">${esc(rs(p.alreadyPostedCOGS))}</td>
        </tr>
        <tr>
          <td class="bold">Variance to post</td>
          <td class="num bold">${esc(rs(p.variance))}</td>
        </tr>
        <tr>
          <td colspan="2" class="muted xs">${esc(varianceNote)}</td>
        </tr>
        <tr>
          <td colspan="2" class="muted xs">Informational: production_output JVs in this period sum to ${esc(rs(p.productionAdditions))} — not part of the formula.</td>
        </tr>
      </tbody>
    </table>

    ${p.unpricedCount > 0 ? `<div class="muted xs" style="margin-top: 8px;">Warning: ${p.unpricedCount} items have stock but no costing value — figures above may be understated.</div>` : ""}
  `;
}

function detailsHtml(p: PeriodicCOGSPreview, d: PeriodicCOGSDetails): string {
  const period = `${fmtDate(p.fromDate)} — ${fmtDate(p.toDate)}`;
  return `
    ${stockTable(
      "Previous Closing — Raw Materials",
      `Latest consumption stock closing per material before ${fmtDate(p.fromDate)}, valued at raw-material cost value.`,
      d.prevRM
    )}
    ${stockTable(
      "Previous Closing — FG + WIP",
      `Latest daily stock closing per item before ${fmtDate(p.fromDate)}, valued at planning-item costing value.`,
      d.prevFG
    )}
    ${voucherTable(
      "Net RM Purchases (this period)",
      `Posted vouchers hitting the RM Inventory account in ${period}, net Dr − Cr per voucher, excluding consumption / production output / periodic COGS entries.`,
      d.rmPurchases,
      "Net Dr − Cr (Rs.)"
    )}
    ${stockTable(
      "Current Closing — Raw Materials",
      `Latest consumption stock closing per material in ${period}, valued at raw-material cost value.`,
      d.currRM
    )}
    ${stockTable(
      "Current Closing — FG + WIP",
      `Latest daily stock closing per item in ${period}, valued at planning-item costing value.`,
      d.currFG
    )}
    ${voucherTable(
      "Already Posted COGS (this period)",
      "Per-dispatch COGS vouchers plus prior periodic adjustments — what the variance reconciles against.",
      d.alreadyPosted,
      "Amount (Rs.)"
    )}
    ${voucherTable(
      "Production Output JVs (informational)",
      "Not part of the COGS formula — shown as a sanity check against the production flow.",
      d.production,
      "Amount (Rs.)"
    )}
  `;
}

/** Print the calculation summary; pass details to append every underlying row. */
export function printPeriodicCOGS(preview: PeriodicCOGSPreview, details?: PeriodicCOGSDetails | null): void {
  const html = `
    <div class="wrap">
      ${summaryHtml(preview)}
      ${details ? detailsHtml(preview, details) : ""}
      <div class="sign">
        <div>Prepared By</div>
        <div>Checked By</div>
        <div>Approved By</div>
      </div>
    </div>`;
  const title = `Periodic COGS ${preview.fromDate} - ${preview.toDate}${details ? " (full detail)" : ""}`;
  printDocument(title, html);
}
