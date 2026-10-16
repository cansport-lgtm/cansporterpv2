// Printed Private Label / Company Product Job Order form (one A4 page per order).
import { format, parseISO } from "date-fns";
import cansportLogo from "@/assets/cansport-logo.png";
import { esc, printDocument } from "@/lib/printDocument";
import { isImage, publicUrl, type PljoDetail } from "@/lib/privateLabelJobOrder";

const companyLogoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

const PLJO_PRINT_CSS = `
  .logo-box { border: 1px solid #ccc; border-radius: 4px; padding: 8px; text-align: center; margin-bottom: 16px; }
  .logo-box img { max-height: 140px; max-width: 100%; }
  .grade { font-size: 16px; font-weight: 700; }
`;

const fmtDate = (d: string | null) => (d ? format(parseISO(d), "dd MMM yyyy") : "—");

export function printPrivateLabelJobOrder(detail: PljoDetail) {
  if (detail.order.order_type === "company") return printCompanyJobOrder(detail);
  const { order, lines, attachments } = detail;
  const logo = attachments.find((a) => a.kind === "logo");

  let totalQty = 0;
  const rows = lines
    .map((l, i) => {
      const qty = Number(l.quantity);
      totalQty += qty;
      return `<tr>
        <td>${i + 1}</td>
        <td class="bold">${esc(l.size_name)}</td>
        <td>${esc(l.color_name || "—")}</td>
        <td class="num bold">${qty.toLocaleString()}</td>
        <td>${esc(l.packing_label)}</td>
        <td>${esc(l.remarks)}</td>
      </tr>`;
    })
    .join("");

  const logoHtml = logo
    ? isImage(logo.mime_type)
      ? `<div class="logo-box"><div class="label">Logo</div><img src="${esc(publicUrl(logo.file_path))}" alt="Logo" /></div>`
      : `<div class="logo-box"><div class="label">Logo</div>${esc(logo.file_name)} (see attached file)</div>`
    : `<div class="logo-box muted">No logo uploaded</div>`;

  const body = `
    <style>${PLJO_PRINT_CSS}</style>
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <img src="${esc(companyLogoUrl)}" alt="Cansport" />
          <div><h1>PRIVATE LABEL JOB ORDER</h1><div class="xs muted">Production Planning</div></div>
        </div>
        <div class="right">
          <div class="bold" style="font-size:16px">${esc(order.pl_job_order_number)}</div>
          <div>Order date: ${esc(fmtDate(order.order_date))}</div>
          <div>Required by: ${esc(fmtDate(order.required_by_date))}</div>
          <div>Priority: ${esc(order.priority)}</div>
          <div class="status">${esc(order.status)}</div>
        </div>
      </div>

      <div class="grid2">
        <div>
          <div class="label">Customer</div>
          <div class="bold">${esc(order.customers?.name ?? "")}</div>
          <div>Bill to: ${esc(order.billing_customer?.name ?? order.customers?.name ?? "")}</div>
          ${order.brand_name ? `<div>Brand: ${esc(order.brand_name)}</div>` : ""}
          ${order.customer_po_ref ? `<div>Customer PO / Ref: ${esc(order.customer_po_ref)}</div>` : ""}
        </div>
        <div>
          <div class="label">Grade</div>
          <div class="grade">${esc(order.grades?.name ?? "")}</div>
        </div>
      </div>

      ${logoHtml}

      <table>
        <thead><tr>
          <th>#</th><th>Size</th><th>Color</th><th class="num">Qty (Dz)</th><th>Packing</th><th>Remarks</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td></td><td>Total</td><td></td><td class="num">${totalQty.toLocaleString()}</td><td></td><td></td>
        </tr></tfoot>
      </table>

      ${order.remarks ? `<div class="section-title">Remarks</div><div>${esc(order.remarks)}</div>` : ""}

      <div class="sign">
        <div>Prepared by</div><div>Checked by</div><div>Approved by</div>
      </div>
      <div class="xs muted" style="margin-top:12px">Printed ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}</div>
    </div>`;

  printDocument(order.pl_job_order_number, body);
}

function printCompanyJobOrder(detail: PljoDetail) {
  const { order, lines } = detail;

  let totalQty = 0;
  const rows = lines
    .map((l, i) => {
      const qty = Number(l.quantity);
      totalQty += qty;
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(l.product_code)}</td>
        <td class="bold">${esc(l.product_name)}</td>
        <td>${esc(l.product_grade || "—")}</td>
        <td class="num bold">${qty.toLocaleString()}</td>
        <td>${esc(l.packing_label)}</td>
        <td>${esc(l.remarks)}</td>
      </tr>`;
    })
    .join("");

  const body = `
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <img src="${esc(companyLogoUrl)}" alt="Cansport" />
          <div><h1>COMPANY PRODUCT JOB ORDER</h1><div class="xs muted">Production Planning</div></div>
        </div>
        <div class="right">
          <div class="bold" style="font-size:16px">${esc(order.pl_job_order_number)}</div>
          <div>Order date: ${esc(fmtDate(order.order_date))}</div>
          <div>Required by: ${esc(fmtDate(order.required_by_date))}</div>
          <div>Priority: ${esc(order.priority)}</div>
          <div class="status">${esc(order.status)}</div>
        </div>
      </div>

      <table>
        <thead><tr>
          <th>#</th><th>Code</th><th>Product</th><th>Grade</th><th class="num">Qty (Dz)</th><th>Packing</th><th>Remarks</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td></td><td></td><td>Total</td><td></td><td class="num">${totalQty.toLocaleString()}</td><td></td><td></td>
        </tr></tfoot>
      </table>

      ${order.remarks ? `<div class="section-title">Remarks</div><div>${esc(order.remarks)}</div>` : ""}

      <div class="sign">
        <div>Prepared by</div><div>Checked by</div><div>Approved by</div>
      </div>
      <div class="xs muted" style="margin-top:12px">Printed ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}</div>
    </div>`;

  printDocument(order.pl_job_order_number, body);
}
