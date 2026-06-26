import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import cansportLogo from "@/assets/cansport-logo.png";

interface DispatchSheetPrintViewProps {
  /** When non-null, the order is fetched and the browser print dialog is opened. */
  orderId: string | null;
  /** Called after the print dialog has been triggered so the caller can clear its state. */
  onAfterPrint: () => void;
}

interface PrintOrder {
  order_number: string | null;
  order_date: string;
  required_date: string | null;
  status: string;
  dispatched_at: string | null;
  notes: string | null;
  dispatch_notes: string | null;
  distributors: {
    name: string;
    code: string | null;
    address: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    contact_person: string | null;
  } | null;
  distributor_customers: {
    name: string;
    code: string | null;
    address: string | null;
    city: string | null;
    area: string | null;
    phone: string | null;
    contact_person: string | null;
  } | null;
}

interface PrintItem {
  id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  quantity_dispatched: number;
  remarks: string | null;
  company_product: { code: string | null; name: string } | null;
}

function addressLine(p: { address: string | null; area: string | null; city: string | null } | null) {
  if (!p) return "";
  return [p.address, p.area, p.city].filter(Boolean).join(", ");
}

/**
 * Hidden, print-only distributor dispatch sheet (delivery / picking slip). Self-fetches
 * the order header (distributor + customer) and its lines, then fires `window.print()`
 * once both are loaded. The layout overlays the screen during print
 * (`print:fixed print:inset-0`) so only the dispatch sheet is printed. Use the browser's
 * "Save as PDF" destination to export a PDF. Reused from the Dispatch page once an order
 * is approved so warehouse staff can pick and dispatch the goods.
 */
export function DispatchSheetPrintView({ orderId, onAfterPrint }: DispatchSheetPrintViewProps) {
  const { data: order } = useQuery({
    queryKey: ["dispatch-sheet-print-view", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_orders")
        .select(
          "order_number, order_date, required_date, status, dispatched_at, notes, dispatch_notes, distributors(name, code, address, city, area, phone, contact_person), distributor_customers(name, code, address, city, area, phone, contact_person)"
        )
        .eq("id", orderId as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PrintOrder;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["dispatch-sheet-print-view-items", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_order_items")
        .select("id, product_name, unit, quantity, quantity_dispatched, remarks, company_product:products(code, name)")
        .eq("order_id", orderId as string)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as PrintItem[];
    },
  });

  useEffect(() => {
    if (!orderId || !order || !items) return;
    const t = setTimeout(() => {
      window.print();
      onAfterPrint();
    }, 250);
    return () => clearTimeout(t);
    // onAfterPrint intentionally omitted; we only want to fire once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order, items]);

  if (!order || !items) return null;

  const totalOrdered = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
  const totalDispatched = items.reduce((s, it) => s + Number(it.quantity_dispatched ?? 0), 0);

  return (
    <div className="hidden print:block print:fixed print:inset-0 print:bg-white print:p-8 print:z-50 print:text-foreground">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-gray-800">
          <div className="flex items-center gap-3">
            <img src={cansportLogo} alt="Cansport" className="h-12 w-auto" />
            <div>
              <h1 className="text-2xl font-bold leading-tight">DISPATCH SHEET</h1>
              <div className="text-xs text-gray-500">Delivery / Picking Slip</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold">{order.order_number ?? "—"}</div>
            <div>Order date: {format(parseISO(order.order_date), "dd MMM yyyy")}</div>
            {order.required_date && (
              <div>Required: {format(parseISO(order.required_date), "dd MMM yyyy")}</div>
            )}
            {order.dispatched_at && (
              <div>Dispatched: {format(parseISO(order.dispatched_at), "dd MMM yyyy")}</div>
            )}
            <div className="uppercase text-xs mt-1 font-semibold">{order.status}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
          <div>
            <div className="font-bold text-xs text-gray-500 mb-1">DISTRIBUTOR</div>
            <div className="font-bold">{order.distributors?.name}</div>
            {order.distributors?.code && <div className="text-xs">{order.distributors.code}</div>}
            {addressLine(order.distributors) && (
              <div className="text-xs text-gray-600">{addressLine(order.distributors)}</div>
            )}
            {order.distributors?.phone && (
              <div className="text-xs text-gray-600">Ph: {order.distributors.phone}</div>
            )}
          </div>
          <div>
            <div className="font-bold text-xs text-gray-500 mb-1">DELIVER TO</div>
            <div className="font-bold">{order.distributor_customers?.name}</div>
            {order.distributor_customers?.code && (
              <div className="text-xs">{order.distributor_customers.code}</div>
            )}
            {addressLine(order.distributor_customers) && (
              <div className="text-xs text-gray-600">{addressLine(order.distributor_customers)}</div>
            )}
            {order.distributor_customers?.contact_person && (
              <div className="text-xs text-gray-600">
                Attn: {order.distributor_customers.contact_person}
              </div>
            )}
            {order.distributor_customers?.phone && (
              <div className="text-xs text-gray-600">Ph: {order.distributor_customers.phone}</div>
            )}
          </div>
        </div>

        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">Product</th>
              <th className="text-left py-2">Unit</th>
              <th className="text-right py-2">Ordered</th>
              <th className="text-right py-2">Dispatched</th>
              <th className="text-left py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="py-2 align-top">{i + 1}</td>
                <td className="py-2">
                  {it.product_name}
                  {it.company_product?.code ? (
                    <div className="text-xs text-gray-600 mt-0.5">SKU: {it.company_product.code}</div>
                  ) : null}
                </td>
                <td className="py-2">{it.unit ?? "—"}</td>
                <td className="text-right py-2">{Number(it.quantity ?? 0).toLocaleString()}</td>
                <td className="text-right py-2 font-medium">
                  {Number(it.quantity_dispatched ?? 0).toLocaleString()}
                </td>
                <td className="py-2 text-xs">{it.remarks ?? ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-bold">
              <td colSpan={3} className="text-right py-3">TOTAL</td>
              <td className="text-right py-3">{totalOrdered.toLocaleString()}</td>
              <td className="text-right py-3">{totalDispatched.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {(order.notes || order.dispatch_notes) && (
          <div className="mb-6 text-sm">
            <div className="font-bold text-xs text-gray-500 mb-1">NOTES</div>
            {order.notes && <div>{order.notes}</div>}
            {order.dispatch_notes && <div className="text-gray-600">{order.dispatch_notes}</div>}
          </div>
        )}

        <div className="text-xs text-gray-500 border-t pt-4 mt-8">
          <div className="mt-8 grid grid-cols-3 gap-8">
            <div className="border-t border-gray-400 pt-1">Prepared By</div>
            <div className="border-t border-gray-400 pt-1">Dispatched By</div>
            <div className="border-t border-gray-400 pt-1">Received By</div>
          </div>
        </div>
      </div>
    </div>
  );
}
