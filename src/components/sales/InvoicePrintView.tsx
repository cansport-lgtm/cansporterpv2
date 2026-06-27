import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

interface InvoicePrintViewProps {
  /** When non-null, the invoice is fetched and the browser print dialog is opened. */
  invoiceId: string | null;
  /** Called after the print dialog has been triggered so the caller can clear its state. */
  onAfterPrint: () => void;
}

/**
 * Hidden, print-only domestic invoice layout. Self-fetches the invoice header
 * and its line items, then fires `window.print()` once both are loaded. The
 * layout overlays the screen during print (`print:fixed print:inset-0`) so only
 * the invoice is printed. Reused by the Domestic Invoices list and the
 * Customer / Party Ledger deep-link.
 */
export function InvoicePrintView({ invoiceId, onAfterPrint }: InvoicePrintViewProps) {
  const { data: invoice } = useQuery({
    queryKey: ["invoice-print-view", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const { data, error } = await sb
        .from("domestic_invoices")
        .select("*, customer:customers(name, code), dispatch:sales_dispatches(dispatch_number, dispatch_date)")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId,
  });

  const { data: items } = useQuery({
    queryKey: ["invoice-print-view-items", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await sb
        .from("domestic_invoice_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("line_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!invoiceId,
  });

  useEffect(() => {
    if (!invoiceId || !invoice || !items) return;
    const t = setTimeout(() => {
      window.print();
      onAfterPrint();
    }, 250);
    return () => clearTimeout(t);
    // onAfterPrint intentionally omitted; we only want to fire once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, invoice, items]);

  if (!invoice || !items) return null;

  return (
    <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8 print:z-50 print:text-foreground">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-gray-800">
          <div>
            <h1 className="text-2xl font-bold">INVOICE</h1>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold">{invoice.invoice_number}</div>
            <div>Date: {format(parseISO(invoice.invoice_date), "dd MMM yyyy")}</div>
            {invoice.due_date && <div>Due: {format(parseISO(invoice.due_date), "dd MMM yyyy")}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <div className="font-bold text-xs text-gray-500 mb-1">BILL TO</div>
            <div className="font-bold">{invoice.customer?.name}</div>
            <div className="text-xs">{invoice.customer?.code}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Dispatch ref: {invoice.dispatch?.dispatch_number}</div>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">Product</th>
              <th className="text-left py-2">Grade / Packing</th>
              <th className="text-right py-2">Qty (Dz)</th>
              <th className="text-right py-2">Rate / Dz</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any, i: number) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="py-2">{i + 1}</td>
                <td className="py-2">
                  {it.description || "—"}
                  {it.details ? <div className="text-xs text-gray-600 mt-0.5">{it.details}</div> : null}
                </td>
                <td className="py-2 text-xs">{it.grade_name || ""}{it.packing_type ? ` / ${it.packing_type}` : ""}</td>
                <td className="text-right py-2">{Number(it.quantity_dozens).toLocaleString()}</td>
                <td className="text-right py-2">Rs. {Number(it.price_per_dozen).toLocaleString()}</td>
                <td className="text-right py-2 font-medium">Rs. {Number(it.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Number(invoice.discount) > 0 && (
              <>
                <tr className="border-t-2 border-gray-800">
                  <td colSpan={3} className="text-right py-2">Subtotal</td>
                  <td className="text-right py-2">{(items || []).reduce((s: number, it: any) => s + Number(it.quantity_dozens || 0), 0).toLocaleString()} Dz</td>
                  <td></td>
                  <td className="text-right py-2">Rs. {(items || []).reduce((s: number, it: any) => s + Number(it.amount || 0), 0).toLocaleString()}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="text-right py-2">Discount</td>
                  <td className="text-right py-2">- Rs. {Number(invoice.discount).toLocaleString()}</td>
                </tr>
              </>
            )}
            <tr className={`font-bold ${Number(invoice.discount) > 0 ? "" : "border-t-2 border-gray-800"}`}>
              <td colSpan={3} className="text-right py-3">TOTAL</td>
              <td className="text-right py-3">{(items || []).reduce((s: number, it: any) => s + Number(it.quantity_dozens || 0), 0).toLocaleString()} Dz</td>
              <td></td>
              <td className="text-right py-3">Rs. {Number(invoice.total_amount).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.notes && (
          <div className="mb-6 text-sm">
            <div className="font-bold text-xs text-gray-500 mb-1">NOTES</div>
            <div>{invoice.notes}</div>
          </div>
        )}

        <div className="text-xs text-gray-500 border-t pt-4 mt-8">
          <div className="mt-4 grid grid-cols-2 gap-8">
            <div className="border-t pt-1">Authorized Signature</div>
            <div className="border-t pt-1">Customer Acknowledgement</div>
          </div>
        </div>
      </div>
    </div>
  );
}
