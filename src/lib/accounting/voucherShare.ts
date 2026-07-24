// Print / WhatsApp-share a single accounting voucher.
//
// Self-fetches the voucher header and its Dr/Cr lines by id so callers (ledger
// rows, voucher dialogs) only need the voucher id. Printing goes through the
// shared hidden-iframe printer; WhatsApp uses the native share sheet with a
// generated PDF on mobile and falls back to download + wa.me elsewhere
// (same pattern as the Party/General Ledger share buttons).

import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { printDocument, esc } from "@/lib/printDocument";
import { PdfToken, padLeft, padRight, renderTextPdf } from "@/lib/pdfBuilder";
import { shareOrDownloadPdf, SharePdfResult } from "@/lib/sharePdf";

const sb = supabase as any;

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  CRV: "Cash Receipt Voucher",
  CPV: "Cash Payment Voucher",
  BRV: "Bank Receipt Voucher",
  BPV: "Bank Payment Voucher",
  JV: "Journal Voucher",
  CV: "Contra Voucher",
  OB: "Opening Balance",
};

interface VoucherBundle {
  voucher: any;
  lines: any[];
}

async function fetchVoucherBundle(voucherId: string): Promise<VoucherBundle> {
  const { data: voucher, error: vErr } = await sb
    .from("accounting_vouchers")
    .select("*, party:accounting_parties(name)")
    .eq("id", voucherId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!voucher) throw new Error("Voucher not found");

  const { data: lines, error: lErr } = await sb
    .from("accounting_voucher_lines")
    .select("*, account:accounting_chart_of_accounts(code, name), party:accounting_parties(name)")
    .eq("voucher_id", voucherId)
    .order("line_order");
  if (lErr) throw lErr;

  return { voucher, lines: lines || [] };
}

const rs = (n: number) => `Rs. ${Number(n || 0).toLocaleString()}`;

// ---------------------------------------------------------------- Print -----

function voucherPrintHtml({ voucher, lines }: VoucherBundle): string {
  const typeLabel = VOUCHER_TYPE_LABELS[voucher.voucher_type] || "Voucher";
  const dateStr = voucher.voucher_date ? format(parseISO(voucher.voucher_date), "dd MMM yyyy") : "—";
  const totalDr = lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0);

  const lineRows = lines
    .map(
      (l) => `
        <tr>
          <td><span style="font-family: monospace;">${esc(l.account?.code || "")}</span> ${esc(l.account?.name || "—")}</td>
          <td>${esc(l.party?.name || "—")}</td>
          <td class="num">${Number(l.debit_amount) > 0 ? esc(rs(l.debit_amount)) : "—"}</td>
          <td class="num">${Number(l.credit_amount) > 0 ? esc(rs(l.credit_amount)) : "—"}</td>
          <td class="muted">${esc(l.line_narration || "—")}</td>
        </tr>`
    )
    .join("");

  return `
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <div>
            <h1>${esc(typeLabel)}</h1>
            <div class="muted xs">${esc(voucher.voucher_number || "")}</div>
          </div>
        </div>
        <div class="right">
          <div class="label">Date</div>
          <div class="bold">${esc(dateStr)}</div>
        </div>
      </div>

      <div class="grid2">
        <div>
          <div class="label">Party</div>
          <div>${esc(voucher.party?.name || "—")}</div>
        </div>
        <div>
          <div class="label">Amount</div>
          <div class="bold">${esc(rs(voucher.total_amount))}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="status">${esc(voucher.status || "")}</div>
        </div>
      </div>

      ${voucher.narration ? `<div style="margin-bottom: 12px;"><div class="label">Narration</div><div>${esc(voucher.narration)}</div></div>` : ""}

      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Party</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total</td>
            <td class="num">${esc(rs(totalDr))}</td>
            <td class="num">${esc(rs(totalCr))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div class="sign">
        <div>Prepared By</div>
        <div>Approved By</div>
        <div>Received By</div>
      </div>
    </div>`;
}

/** Fetch a voucher by id and open the browser print dialog for it. */
export async function printVoucher(voucherId: string): Promise<void> {
  const bundle = await fetchVoucherBundle(voucherId);
  const title = `${bundle.voucher.voucher_number || "Voucher"}`;
  printDocument(title, voucherPrintHtml(bundle));
}

// ------------------------------------------------------------- WhatsApp -----

// Portrait A4 (points) for the shared voucher PDF.
const PAGE_W = 595;
const PAGE_H = 842;
const LINE_H = 13;
const BODY_SIZE = 9;

const COLS = { account: 30, party: 18, debit: 13, credit: 13, note: 20 };

function pdfLine(account: string, party: string, debit: string, credit: string, note: string): string {
  return (
    padRight(account, COLS.account) + " " +
    padRight(party, COLS.party) + " " +
    padLeft(debit, COLS.debit) + " " +
    padLeft(credit, COLS.credit) + " " +
    padRight(note, COLS.note)
  );
}

function buildVoucherPdf({ voucher, lines }: VoucherBundle): Blob {
  const typeLabel = VOUCHER_TYPE_LABELS[voucher.voucher_type] || "Voucher";
  const dateStr = voucher.voucher_date ? format(parseISO(voucher.voucher_date), "dd MMM yyyy") : "—";
  const totalDr = lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0);

  const page: PdfToken[] = [];
  const push = (text: string, bold = false, size = BODY_SIZE) => page.push({ text, bold, size });

  push(typeLabel, true, 14);
  push(voucher.voucher_number || "", true, 10);
  push("");
  push(`Date:   ${dateStr}`);
  push(`Party:  ${voucher.party?.name || "-"}`);
  push(`Amount: ${rs(voucher.total_amount)}`, true);
  if (voucher.narration) push(`Note:   ${voucher.narration}`);
  push("");

  const header = pdfLine("Account", "Party", "Debit", "Credit", "Note");
  push(header, true);
  push("-".repeat(header.length));
  for (const l of lines) {
    push(
      pdfLine(
        `${l.account?.code || ""} ${l.account?.name || ""}`.trim(),
        l.party?.name || "-",
        Number(l.debit_amount) > 0 ? rs(l.debit_amount) : "-",
        Number(l.credit_amount) > 0 ? rs(l.credit_amount) : "-",
        l.line_narration || "-"
      )
    );
  }
  push("-".repeat(header.length));
  push(pdfLine("Total", "", rs(totalDr), rs(totalCr), ""), true);

  return renderTextPdf([page], {
    pageW: PAGE_W,
    pageH: PAGE_H,
    marginX: 40,
    marginTop: 46,
    lineH: LINE_H,
  });
}

/**
 * Fetch a voucher by id and share it to WhatsApp as a PDF — native share
 * sheet on mobile, download + wa.me text fallback on desktop.
 */
export async function shareVoucherWhatsApp(voucherId: string): Promise<SharePdfResult> {
  const bundle = await fetchVoucherBundle(voucherId);
  const { voucher } = bundle;
  const typeLabel = VOUCHER_TYPE_LABELS[voucher.voucher_type] || "Voucher";
  const dateStr = voucher.voucher_date ? format(parseISO(voucher.voucher_date), "dd MMM yyyy") : "—";
  const summary =
    `${typeLabel} ${voucher.voucher_number || ""}`.trim() +
    `\nDate: ${dateStr}` +
    (voucher.party?.name ? `\nParty: ${voucher.party.name}` : "") +
    `\nAmount: ${rs(voucher.total_amount)}` +
    (voucher.narration ? `\nNote: ${voucher.narration}` : "");

  return shareOrDownloadPdf({
    blob: buildVoucherPdf(bundle),
    fileName: `${(voucher.voucher_number || "voucher").replace(/[^\w-]+/g, "_")}.pdf`,
    title: `${typeLabel} ${voucher.voucher_number || ""}`.trim(),
    text: summary,
  });
}
