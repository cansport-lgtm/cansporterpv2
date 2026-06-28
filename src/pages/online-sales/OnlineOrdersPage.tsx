import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingBag, Plus, Search, Download, Upload, Printer, Truck, ScanLine, Weight, FileUp, Trash2 } from "lucide-react";
import { QRScannerDialog } from "@/components/fixed-assets/QRScannerDialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

const STATUSES = ["pending", "confirmed", "sent_to_courier", "dispatched", "delivered", "return_awaited", "returned", "cancelled"];

const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["sent_to_courier", "cancelled"],
  sent_to_courier: ["dispatched", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  return_awaited: [],
  returned: [],
  cancelled: [],
};

const STATUS_COLORS: Record<string, string> = {
  pending: "secondary",
  confirmed: "default",
  sent_to_courier: "outline",
  dispatched: "default",
  delivered: "default",
  return_awaited: "outline",
  returned: "secondary",
  cancelled: "destructive",
};

const EXPORT_COLUMNS = [
  "order_number", "platform", "platform_order_id", "tracking_number", "order_date",
  "customer_name", "customer_phone", "customer_email",
  "shipping_address", "city", "state", "pincode",
  "payment_mode", "order_value", "booking_weight", "actual_weight",
  "origin_city", "return_city", "pickup_date", "delivery_date",
  "status", "remarks",
];
const IMPORT_REQUIRED = ["customer_name"];

interface LiveItem {
  itemId: string;
  qty: number;
}

export default function OnlineOrdersPage() {
  const { user, roles } = useAuth();
  const isPackingRole = roles.some(r => (r.role as string) === 'online_sales_packing');
  const isSuperAdmin = roles.some(r => (r.role as string) === 'super_admin');
  const [orders, setOrders] = useState<any[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [onlineItems, setOnlineItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [weightDialogOpen, setWeightDialogOpen] = useState(false);
  const [weightOrder, setWeightOrder] = useState<any>(null);
  const [liveWeight, setLiveWeight] = useState("");
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [uploadingStatus, setUploadingStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    platform: "",
    platform_order_id: "",
    tracking_number: "",
    order_date: format(new Date(), "yyyy-MM-dd"),
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    shipping_address: "",
    city: "",
    state: "",
    pincode: "",
    payment_mode: "prepaid",
    order_value: "",
    remarks: "",
  });

  useEffect(() => {
    fetchOrders();
    fetchPlatforms();
    fetchOnlineItems();
  }, []);

  const fetchPlatforms = async () => {
    const { data } = await supabase.from("online_platforms").select("name").eq("is_active", true).order("name");
    const names = (data || []).map((p: any) => p.name);
    setPlatforms(names);
    if (names.length > 0 && !form.platform) {
      setForm(prev => ({ ...prev, platform: names[0] }));
    }
  };

  const fetchOnlineItems = async () => {
    const { data } = await supabase.from("online_items").select("id, name, code").eq("is_active", true).order("name");
    setOnlineItems(data || []);
  };

  const fetchOrders = async () => {
    setLoading(true);
    const { data } = await supabase.from("online_orders").select("*, online_dispatches(awb_number)").order("created_at", { ascending: false });
    
    // Fetch all order items in one go
    const orderIds = (data || []).map((o: any) => o.id);
    let orderItemsMap: Record<string, any[]> = {};
    if (orderIds.length > 0) {
      // Batch in chunks of 500 to avoid Supabase query limits
      const chunkSize = 500;
      for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        const { data: itemsData } = await supabase.from("online_order_items").select("*").in("order_id", chunk);
        (itemsData || []).forEach((item: any) => {
          if (!orderItemsMap[item.order_id]) orderItemsMap[item.order_id] = [];
          orderItemsMap[item.order_id].push(item);
        });
      }
    }

    setOrders((data || []).map((o: any) => {
      const trackNum = o.tracking_number || o.online_dispatches?.[0]?.awb_number || "";
      const items = orderItemsMap[o.id] || [];
      const itemDisplay = items.length > 0
        ? items.map((i: any) => `${i.item_name} x${i.quantity}`).join(", ")
        : (o.item_name || "-");
      return { ...o, _tracking: trackNum, _orderItems: items, _itemDisplay: itemDisplay };
    }));
    setLoading(false);
    setSelectedIds(new Set());
  };

  const handleCreate = async () => {
    if (!form.customer_name || !form.platform) {
      toast.error("Customer name and platform are required");
      return;
    }
    const { error } = await supabase.from("online_orders").insert({
      ...form,
      order_number: "",
      order_value: parseFloat(form.order_value) || 0,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Order created");
    setIsDialogOpen(false);
    setForm({ platform: platforms[0] || "", platform_order_id: "", tracking_number: "", order_date: format(new Date(), "yyyy-MM-dd"), customer_name: "", customer_phone: "", customer_email: "", shipping_address: "", city: "", state: "", pincode: "", payment_mode: "prepaid", order_value: "", remarks: "" });
    fetchOrders();
  };

  const [postexBusy, setPostexBusy] = useState(false);

  // Book a parcel on PostEx via the server-side Edge Function (token stays server-side).
  const bookOnPostex = async (id: string) => {
    setPostexBusy(true);
    const { data, error } = await supabase.functions.invoke("postex", { body: { action: "book", orderId: id } });
    setPostexBusy(false);
    if (error || (data && (data as any).error)) {
      toast.error(`PostEx booking failed: ${(data as any)?.error || error?.message || "unknown error"}`);
      return;
    }
    toast.success(`Booked on PostEx — tracking ${(data as any)?.trackingNumber}`);
    fetchOrders();
  };

  // Import unbooked orders created on the PostEx portal (super admin only).
  const importFromPostex = async () => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setPostexBusy(true);
    const { data, error } = await supabase.functions.invoke("postex", {
      body: { action: "import", startDate: fmt(start), endDate: fmt(end) },
    });
    setPostexBusy(false);
    if (error || (data && (data as any).error)) {
      toast.error(`Import failed: ${(data as any)?.error || error?.message || "unknown error"}`);
      return;
    }
    const d = data as any;
    toast.success(`Imported ${d?.inserted ?? 0} new orders (${d?.found ?? 0} found, ${d?.skipped ?? 0} already present)`);
    fetchOrders();
  };

  // Pull the latest courier status for all in-transit parcels (replaces manual sheet upload).
  const syncTracking = async () => {
    setPostexBusy(true);
    const { data, error } = await supabase.functions.invoke("postex", { body: { action: "track" } });
    setPostexBusy(false);
    if (error || (data && (data as any).error)) {
      toast.error(`Tracking sync failed: ${(data as any)?.error || error?.message || "unknown error"}`);
      return;
    }
    const d = data as any;
    toast.success(`Synced ${d?.tracked ?? 0} parcels, ${d?.updated ?? 0} status changes`);
    fetchOrders();
  };

  const updateStatus = async (id: string, newStatus: string) => {
    const updateData: Record<string, any> = { status: newStatus };
    if (newStatus === "confirmed") {
      updateData.confirmed_at = new Date().toISOString();
      updateData.confirmed_by = user?.id;
    }
    const { error } = await supabase.from("online_orders").update(updateData).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Status updated to ${newStatus.replace(/_/g, " ")}`);
    fetchOrders();
  };

  const bulkMarkSentToCourier = async () => {
    const eligibleOrders = orders.filter(o => selectedIds.has(o.id) && (o.status === "pending" || o.status === "confirmed"));
    if (eligibleOrders.length === 0) {
      toast.error("No pending/confirmed orders selected");
      return;
    }
    const zeroItems = eligibleOrders.filter(o => !(o.actual_weight > 0) || !(o.quantity > 0));
    if (zeroItems.length > 0) {
      toast.error(`${zeroItems.length} order(s) have 0 weight or 0 qty – scan & weigh them first`);
      return;
    }
    const ids = eligibleOrders.map(o => o.id);
    const { error } = await supabase.from("online_orders").update({ status: "sent_to_courier" }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} orders marked as sent to courier`);
    fetchOrders();
  };

  const handlePrintDispatchSheet = () => {
    const allSelected = orders.filter(o => selectedIds.has(o.id));
    if (allSelected.length === 0) {
      toast.error("Select orders to print dispatch sheet");
      return;
    }
    const selected = allSelected.filter(o => (o.actual_weight > 0) && (o.quantity > 0));
    const skipped = allSelected.length - selected.length;
    if (skipped > 0) toast.warning(`${skipped} order(s) with 0 weight/qty excluded from dispatch sheet`);
    if (selected.length === 0) {
      toast.error("No orders with weight & qty to print");
      return;
    }
    const rows = selected.map((o, i) => `
      <tr>
        <td style="border:1px solid #333;padding:6px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #333;padding:6px">${o.order_number || o.platform_order_id || "-"}</td>
        <td style="border:1px solid #333;padding:6px;font-family:monospace;font-size:11px">${o._tracking || "-"}</td>
        <td style="border:1px solid #333;padding:6px">${o.customer_name}</td>
        <td style="border:1px solid #333;padding:6px">${o._itemDisplay || "-"}</td>
        <td style="border:1px solid #333;padding:6px">${o.city || "-"}</td>
        <td style="border:1px solid #333;padding:6px;font-size:11px">${o.shipping_address || "-"}</td>
        <td style="border:1px solid #333;padding:6px;text-align:center">${o.pincode || "-"}</td>
        <td style="border:1px solid #333;padding:6px;text-align:center">${o.actual_weight ? `${o.actual_weight} g` : "-"}</td>
        <td style="border:1px solid #333;padding:6px;text-align:center">${o.quantity || 0}</td>
        <td style="border:1px solid #333;padding:6px;text-align:center">${(o.payment_mode || "").toUpperCase()}</td>
        <td style="border:1px solid #333;padding:6px;text-align:right">Rs. ${(o.order_value || 0).toLocaleString()}</td>
      </tr>`).join("");

    const codOrders = selected.filter(o => (o.payment_mode || "").toLowerCase() === "cod");
    const totalCodAmount = codOrders.reduce((sum, o) => sum + (o.order_value || 0), 0);
    const totalWeight = selected.reduce((sum, o) => sum + (o.actual_weight || 0), 0);
    const totalQty = selected.reduce((sum, o) => sum + (o.quantity || 0), 0);
    const totalAmount = selected.reduce((sum, o) => sum + (o.order_value || 0), 0);

    // Aggregate qty per item across all selected orders
    const itemQtyMap: Record<string, number> = {};
    selected.forEach(o => {
      if (o._orderItems && o._orderItems.length > 0) {
        o._orderItems.forEach((item: any) => {
          const name = item.item_name || "Unknown";
          itemQtyMap[name] = (itemQtyMap[name] || 0) + (item.quantity || 0);
        });
      } else if (o.item_name) {
        itemQtyMap[o.item_name] = (itemQtyMap[o.item_name] || 0) + (o.quantity || 0);
      } else if (o._itemDisplay && o._itemDisplay !== "-") {
        // Fallback: parse from display string e.g. "Item x2, Item2 x3"
        const parts = o._itemDisplay.split(",").map((s: string) => s.trim());
        parts.forEach((part: string) => {
          const match = part.match(/^(.+?)\s*x(\d+)$/);
          if (match) {
            itemQtyMap[match[1].trim()] = (itemQtyMap[match[1].trim()] || 0) + parseInt(match[2]);
          } else if (part) {
            itemQtyMap[part] = (itemQtyMap[part] || 0) + (o.quantity || 1);
          }
        });
      }
    });
    const itemWiseSummary = Object.entries(itemQtyMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, qty]) => `<span style="padding:4px 10px;background:#fff;border:1px solid #ccc;border-radius:4px;font-size:12px;white-space:nowrap">${name}: <strong>${qty}</strong></span>`)
      .join("");

    const html = `<!DOCTYPE html><html><head><title>Dispatch Sheet</title></head><body style="font-family:Arial,sans-serif;padding:20px">
      <h2 style="text-align:center;margin-bottom:4px">Cansport - Online Dispatch Sheet</h2>
      <p style="text-align:center;color:#666;margin-top:0">Date: ${format(new Date(), "dd MMM yyyy")}</p>
      <div style="display:flex;gap:12px;justify-content:center;margin:10px 0 4px;flex-wrap:wrap">
        <div style="padding:10px 20px;background:#e8f5e9;border:1px solid #4caf50;border-radius:6px;font-size:14px;text-align:center"><strong>Total Parcels</strong><br/>${selected.length}</div>
        <div style="padding:10px 20px;background:#e3f2fd;border:1px solid #2196f3;border-radius:6px;font-size:14px;text-align:center"><strong>Total Weight</strong><br/>${totalWeight} g</div>
        <div style="padding:10px 20px;background:#f3e5f5;border:1px solid #9c27b0;border-radius:6px;font-size:14px;text-align:center"><strong>Total Qty</strong><br/>${totalQty}</div>
        <div style="padding:10px 20px;background:#e0f7fa;border:1px solid #00bcd4;border-radius:6px;font-size:14px;text-align:center"><strong>Total Amount</strong><br/>Rs. ${totalAmount.toLocaleString()}</div>
        ${totalCodAmount > 0 ? `<div style="padding:10px 20px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;font-size:14px;text-align:center"><strong>COD Amount</strong><br/>Rs. ${totalCodAmount.toLocaleString()} (${codOrders.length} parcels)</div>` : ''}
      </div>
      ${itemWiseSummary ? `<div style="margin:8px 0 4px;padding:8px 12px;background:#f9f9f9;border:1px solid #ddd;border-radius:6px">
        <strong style="font-size:12px;color:#555">Item-wise Qty:</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${itemWiseSummary}</div>
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:12px">
        <thead>
          <tr style="background:#f0f0f0">
            <th style="border:1px solid #333;padding:6px">S.No</th>
            <th style="border:1px solid #333;padding:6px">Order #</th>
            <th style="border:1px solid #333;padding:6px">Tracking #</th>
            <th style="border:1px solid #333;padding:6px">Customer</th>
            <th style="border:1px solid #333;padding:6px">Item</th>
            <th style="border:1px solid #333;padding:6px">City</th>
            <th style="border:1px solid #333;padding:6px">Address</th>
            <th style="border:1px solid #333;padding:6px">Pincode</th>
            <th style="border:1px solid #333;padding:6px">Weight</th>
            <th style="border:1px solid #333;padding:6px">Qty</th>
            <th style="border:1px solid #333;padding:6px">Payment</th>
            <th style="border:1px solid #333;padding:6px">Value</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.print();</script>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openWeightDialog = async (order: any) => {
    const blockedStatuses = ['sent_to_courier', 'dispatched', 'delivered', 'return_awaited', 'returned'];
    if (blockedStatuses.includes(order.status)) {
      toast.error("Cannot modify — order already dispatched");
      return;
    }
    setWeightOrder(order);
    setLiveWeight(order.actual_weight > 0 ? String(order.actual_weight) : "");

    // Load existing order items
    const { data: existingItems } = await supabase
      .from("online_order_items" as any)
      .select("*")
      .eq("order_id", order.id);

    if (existingItems && existingItems.length > 0) {
      setLiveItems(existingItems.map((i: any) => ({ itemId: i.item_id || "", qty: i.quantity || 1 })));
    } else if (order.item_id) {
      // Legacy single item fallback
      setLiveItems([{ itemId: order.item_id, qty: order.quantity || 1 }]);
    } else {
      setLiveItems([{ itemId: "", qty: 1 }]);
    }
    setWeightDialogOpen(true);
  };

  const handleWeightQRScanned = async (scannedCode: string) => {
    const trimmed = scannedCode.trim();
    setScannedCodes(prev => [...prev, trimmed]);
    setIsScannerOpen(false);

    const matchedOrder = orders.find(o => o.tracking_number === trimmed || o._tracking === trimmed);
    if (matchedOrder) {
      openWeightDialog(matchedOrder);
      return;
    }

    const { data } = await supabase
      .from("online_orders")
      .select("*")
      .eq("tracking_number", trimmed)
      .limit(1);

    if (data && data.length === 1) {
      openWeightDialog(data[0]);
    } else {
      toast.error(`No order found for tracking # ${trimmed}`);
    }
  };

  const handleUpdateWeight = async () => {
    if (!weightOrder) return;
    const weight = parseFloat(liveWeight);

    // Filter out empty item rows
    const validItems = liveItems.filter(li => li.itemId);
    const totalQty = validItems.reduce((sum, li) => sum + (li.qty || 0), 0);

    if ((!liveWeight || isNaN(weight) || weight <= 0) && validItems.length === 0) {
      toast.error("Enter weight or select at least one item");
      return;
    }

    const updateData: Record<string, any> = {};
    if (liveWeight && !isNaN(weight) && weight > 0) updateData.actual_weight = weight;
    if (totalQty > 0) updateData.quantity = totalQty;

    // Update order
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from("online_orders").update(updateData).eq("id", weightOrder.id);
      if (error) { toast.error(error.message); return; }
    }

    // Upsert order items: delete old, insert new
    if (validItems.length > 0) {
      await supabase.from("online_order_items" as any).delete().eq("order_id", weightOrder.id);
      const itemRows = validItems.map(li => {
        const item = onlineItems.find(i => i.id === li.itemId);
        return {
          order_id: weightOrder.id,
          item_id: li.itemId,
          item_name: item ? item.name : "Unknown",
          quantity: li.qty || 1,
        };
      });
      const { error: itemError } = await supabase.from("online_order_items" as any).insert(itemRows);
      if (itemError) { toast.error(itemError.message); return; }
    }

    toast.success(`Updated ${weightOrder.order_number || weightOrder.tracking_number}`);
    setWeightDialogOpen(false);
    setWeightOrder(null);
    setLiveWeight("");
    setLiveItems([]);
    fetchOrders();
  };

  // Courier Status Sheet Upload
  const handleStatusSheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingStatus(true);

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in status sheet");
        setUploadingStatus(false);
        return;
      }

      const mapHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[()%]/g, "");

      let deliveredCount = 0;
      let returnCount = 0;
      let notFoundCount = 0;
      let errorCount = 0;

      for (const row of rows) {
        const mapped: Record<string, any> = {};
        Object.entries(row).forEach(([key, val]) => {
          mapped[mapHeader(key)] = val;
        });

        const trackingNumber = String(mapped.tracking_number || "").trim();
        if (!trackingNumber) { notFoundCount++; continue; }

        const csvStatus = String(mapped.status || "").trim().toLowerCase();
        let newStatus: string | null = null;
        if (csvStatus === "delivered" || csvStatus === "dlvd") {
          newStatus = "delivered";
        } else if (csvStatus === "return" || csvStatus === "rto" || csvStatus === "returned") {
          newStatus = "return_awaited";
        }

        const updateData: Record<string, any> = {};
        if (newStatus) updateData.status = newStatus;

        const courierWeight = parseFloat(mapped["weight_kg"] || mapped["weight"] || "");
        if (!isNaN(courierWeight) && courierWeight > 0) updateData.courier_weight = courierWeight;

        const shippingCharges = parseFloat(mapped.shipping_charges || "");
        if (!isNaN(shippingCharges)) updateData.shipping_charges = shippingCharges;

        const gst = parseFloat(mapped.gst || "");
        if (!isNaN(gst)) updateData.gst = gst;

        const whIncomeTax = parseFloat(mapped["wh_income_tax_2"] || mapped["wh_income_tax"] || "");
        if (!isNaN(whIncomeTax)) updateData.wh_income_tax = whIncomeTax;

        const whSalesTax = parseFloat(mapped["wh_sales_tax_2"] || mapped["wh_sales_tax"] || "");
        if (!isNaN(whSalesTax)) updateData.wh_sales_tax = whSalesTax;

        const netAmount = parseFloat(mapped.net_amount || "");
        if (!isNaN(netAmount)) updateData.net_amount = netAmount;

        const drDate = mapped["d/r_date"] || mapped["dr_date"] || mapped["d_r_date"] || mapped["delivery_date"];
        if (drDate) {
          try {
            const parsed = new Date(drDate);
            if (!isNaN(parsed.getTime())) updateData.delivery_return_date = parsed.toISOString();
          } catch { /* ignore */ }
        }

        if (Object.keys(updateData).length === 0) { notFoundCount++; continue; }

        const { error, count } = await supabase
          .from("online_orders")
          .update(updateData)
          .eq("tracking_number", trackingNumber)
          .select("id");

        if (error) { errorCount++; continue; }

        if (newStatus === "delivered") deliveredCount++;
        else if (newStatus === "return_awaited") returnCount++;
      }

      const parts = [];
      if (deliveredCount > 0) parts.push(`${deliveredCount} delivered`);
      if (returnCount > 0) parts.push(`${returnCount} return awaited`);
      if (notFoundCount > 0) parts.push(`${notFoundCount} not found/skipped`);
      if (errorCount > 0) parts.push(`${errorCount} errors`);
      toast.success(`Status sheet processed: ${parts.join(", ")}`);
      fetchOrders();
    } catch (err) {
      toast.error("Failed to read status sheet");
    } finally {
      setUploadingStatus(false);
      if (statusFileInputRef.current) statusFileInputRef.current.value = "";
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("No orders to export");
      return;
    }
    const exportData = filtered.map(o => {
      const row: Record<string, any> = {};
      EXPORT_COLUMNS.forEach(col => {
        if (col === "order_date" || col === "pickup_date" || col === "delivery_date") {
          const header = col.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          row[header] = o[col] ? format(new Date(o[col]), "yyyy-MM-dd") : "";
        } else {
          const header = col.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          row[header] = o[col] ?? "";
        }
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Online Orders");
    XLSX.writeFile(wb, `Online_Orders_${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast.success(`Exported ${filtered.length} orders`);
  };

  const parseDate = (val: any): string | null => {
    if (!val) return null;
    try {
      let dateStr = String(val).trim();
      if (dateStr.includes(" ")) dateStr = dateStr.split(" ")[0];
      if (/^\d+$/.test(dateStr) && parseInt(dateStr) > 40000) {
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + parseInt(dateStr) * 86400000);
        if (!isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
      } else {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime()) && d.getFullYear() > 1971) return format(d, "yyyy-MM-dd");
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No data found in file");
        setImporting(false);
        return;
      }

      const mapHeader = (h: string) => h.toLowerCase().replace(/\s+/g, "_");
      const firstRowKeys = Object.keys(rows[0]);
      const isCourierFormat = firstRowKeys.some(k => mapHeader(k) === "order_reference_number");

      const ALIAS_MAP: Record<string, string> = {
        order_reference_number: "platform_order_id",
        tracking_number: "tracking_number",
        transaction_date: "order_date",
        merchant_transaction_status: "status_hint",
        customer_phone: "customer_phone",
        origin_city: "origin_city",
        city_name: "city",
        delivery_address: "shipping_address",
        return_city: "return_city",
        order_detail: "remarks",
        invoice_payment: "order_value",
        order_type: "payment_mode",
        order_pickup_date: "pickup_date",
        order_delivery_date: "delivery_date",
        booking_weight: "booking_weight",
        actual_weight: "actual_weight",
      };

      const { data: existingOrders } = await supabase.from("online_orders").select("tracking_number, platform_order_id");
      const existingTracking = new Set((existingOrders || []).filter(o => o.tracking_number).map(o => o.tracking_number));
      const existingPlatformIds = new Set((existingOrders || []).filter(o => o.platform_order_id).map(o => o.platform_order_id));

      let successCount = 0;
      let errorCount = 0;
      let skipCount = 0;

      for (const row of rows) {
        const mapped: Record<string, any> = {};
        Object.entries(row).forEach(([key, val]) => {
          const normalized = mapHeader(key);
          const finalKey = ALIAS_MAP[normalized] || normalized;
          mapped[finalKey] = val;
        });

        const customerName = String(mapped.customer_name || "").trim();
        if (!customerName) { errorCount++; continue; }

        let platformOrderId = String(mapped.platform_order_id || "").trim();
        if (platformOrderId.startsWith("#")) platformOrderId = platformOrderId.substring(1);
        const trackingNumber = String(mapped.tracking_number || "").trim();

        if (trackingNumber && existingTracking.has(trackingNumber)) { skipCount++; continue; }
        if (platformOrderId && existingPlatformIds.has(platformOrderId)) { skipCount++; continue; }

        const orderDate = parseDate(mapped.order_date) || format(new Date(), "yyyy-MM-dd");
        const rawPayment = String(mapped.payment_mode || "prepaid").trim().toLowerCase();
        const paymentMode = rawPayment === "cod" ? "cod" : "prepaid";

        const insertData: Record<string, any> = {
          platform: String(mapped.platform || (isCourierFormat ? "Courier" : "Other")),
          platform_order_id: platformOrderId,
          tracking_number: trackingNumber || null,
          order_date: orderDate,
          customer_name: customerName,
          customer_phone: String(mapped.customer_phone || mapped.phone || "").replace(/\s+/g, "").trim(),
          customer_email: String(mapped.customer_email || mapped.email || ""),
          shipping_address: String(mapped.shipping_address || mapped.address || ""),
          city: String(mapped.city || ""),
          state: String(mapped.state || ""),
          pincode: String(mapped.pincode || ""),
          payment_mode: paymentMode,
          order_value: parseFloat(mapped.order_value || mapped.value || "0") || 0,
          remarks: String(mapped.remarks || ""),
          order_number: "",
          status: "pending",
          booking_weight: parseFloat(mapped.booking_weight) || null,
          actual_weight: parseFloat(mapped.actual_weight) || null,
          origin_city: mapped.origin_city ? String(mapped.origin_city) : null,
          return_city: mapped.return_city ? String(mapped.return_city) : null,
          pickup_date: parseDate(mapped.pickup_date) || null,
          delivery_date: parseDate(mapped.delivery_date) || null,
        };

        const { error } = await supabase.from("online_orders").insert(insertData as any);
        if (error) { errorCount++; } else {
          successCount++;
          if (trackingNumber) existingTracking.add(trackingNumber);
          if (platformOrderId) existingPlatformIds.add(platformOrderId);
        }
      }

      if (successCount > 0) toast.success(`Imported ${successCount} orders`);
      if (skipCount > 0) toast.info(`${skipCount} duplicates skipped`);
      if (errorCount > 0) toast.error(`${errorCount} rows failed`);
      fetchOrders();
    } catch (err) {
      toast.error("Failed to read file");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    const courierHeaders = [
      "ORDER_REFERENCE_NUMBER", "TRACKING_NUMBER", "TRANSACTION_DATE",
      "MERCHANT_TRANSACTION_STATUS", "CUSTOMER_NAME", "CUSTOMER_PHONE",
      "ORIGIN_CITY", "CITY_NAME", "DELIVERY_ADDRESS", "RETURN_CITY",
      "ORDER_DETAIL", "INVOICE_PAYMENT", "ORDER_TYPE",
      "BOOKING_WEIGHT", "ACTUAL_WEIGHT", "ORDER_PICKUP_DATE", "ORDER_DELIVERY_DATE"
    ];
    const sampleRow = [
      "#12345", "AWB001234", "2026-01-01",
      "Unbooked", "John Doe", "9876543210",
      "Ludhiana", "Mumbai", "123 Street, Mumbai", "Ludhiana",
      "Sports goods", "1500", "Normal",
      "500", "600", "2026-01-02", "2026-01-05"
    ];
    const ws = XLSX.utils.aoa_to_sheet([courierHeaders, sampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Online_Orders_Import_Template.xlsx");
    toast.success("Template downloaded");
  };

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
      o.platform_order_id?.toLowerCase().includes(search.toLowerCase()) ||
      o.tracking_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getStatusBadgeVariant = (status: string) => {
    if (status === "delivered") return "default" as const;
    if (status === "cancelled") return "destructive" as const;
    if (status === "sent_to_courier") return "outline" as const;
    if (status === "return_awaited") return "outline" as const;
    return "secondary" as const;
  };

  const getStatusLabel = (status: string) => status.replace(/_/g, " ");

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Online Orders" description="Manage B2C platform orders" icon={ShoppingBag} iconColor="bg-emerald-600 text-white" action={isPackingRole ? undefined : { label: "New Order", onClick: () => setIsDialogOpen(true), icon: Plus }} />

        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search orders, tracking..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>)}
            </SelectContent>
          </Select>
          {!isPackingRole && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
          {!isPackingRole && (
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4 mr-1" /> {importing ? "Importing..." : "Import"}
            </Button>
          )}
          {!isPackingRole && (
            <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-xs text-muted-foreground">
              Download Template
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={() => setIsScannerOpen(true)} className="gap-1">
            <ScanLine className="h-4 w-4" /> Scan & Weigh
          </Button>
          {!isPackingRole && (
            <Button variant="outline" size="sm" onClick={syncTracking} disabled={postexBusy} className="gap-1">
              <Truck className="h-4 w-4" /> {postexBusy ? "Syncing..." : "Sync Tracking"}
            </Button>
          )}
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={importFromPostex} disabled={postexBusy} className="gap-1">
              <Download className="h-4 w-4" /> {postexBusy ? "Importing..." : "Import from PostEx"}
            </Button>
          )}
          {!isPackingRole && (
            <Button variant="outline" size="sm" onClick={() => statusFileInputRef.current?.click()} disabled={uploadingStatus} className="gap-1">
              <FileUp className="h-4 w-4" /> {uploadingStatus ? "Processing..." : "Upload Status Sheet"}
            </Button>
          )}
          <input ref={statusFileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleStatusSheetUpload} />
        </div>

        {/* Bulk action bar */}
        {!isPackingRole && selectedIds.size > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-3 px-4 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">{selectedIds.size} order(s) selected</span>
              <Button size="sm" variant="default" onClick={bulkMarkSentToCourier} className="gap-1">
                <Truck className="h-3.5 w-3.5" /> Mark Sent to Courier
              </Button>
              <Button size="sm" variant="outline" onClick={handlePrintDispatchSheet} className="gap-1">
                <Printer className="h-3.5 w-3.5" /> Print Dispatch Sheet
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {!isPackingRole && (
                    <TableHead className="w-10">
                      <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} />
                    </TableHead>
                  )}
                  <TableHead>Order #</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Tracking #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Item(s)</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Weight (g)</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Value (Rs.)</TableHead>
                  <TableHead>Status</TableHead>
                  {!isPackingRole && (
                    <TableHead>Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                   <TableRow><TableCell colSpan={isPackingRole ? 12 : 14} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                 ) : filtered.length === 0 ? (
                   <TableRow><TableCell colSpan={isPackingRole ? 12 : 14} className="text-center py-8 text-muted-foreground">No orders found</TableCell></TableRow>
                ) : filtered.map(o => {
                  const transitions = STATUS_TRANSITIONS[o.status] || [];
                  return (
                  <TableRow key={o.id}>
                    {!isPackingRole && (
                      <TableCell>
                        <Checkbox checked={selectedIds.has(o.id)} onCheckedChange={() => toggleSelect(o.id)} />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{o.order_number || o.platform_order_id || "-"}</TableCell>
                    <TableCell>{o.platform}</TableCell>
                    <TableCell className="text-xs font-mono">{o._tracking || "-"}</TableCell>
                    <TableCell>{format(new Date(o.order_date), "dd MMM yyyy")}</TableCell>
                    <TableCell>{o.customer_name}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate" title={o._itemDisplay}>{o._itemDisplay}</TableCell>
                    <TableCell>{o.city || "-"}</TableCell>
                    <TableCell className="text-xs">
                      {o.actual_weight > 0 ? (
                        <span className="font-semibold text-primary">{o.actual_weight} g</span>
                      ) : (
                        <span className="text-destructive font-semibold">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.quantity > 0 ? (
                        <span className="font-semibold">{o.quantity}</span>
                      ) : (
                        <span className="text-destructive font-semibold">0</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant={o.payment_mode === "cod" ? "destructive" : "default"}>{o.payment_mode?.toUpperCase()}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{(o.order_value || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant={getStatusBadgeVariant(o.status)}
                        className={
                          o.status === "sent_to_courier" ? "border-amber-500 text-amber-700 bg-amber-50" :
                          o.status === "return_awaited" ? "border-orange-500 text-orange-700 bg-orange-50" : ""
                        }
                      >
                        {getStatusLabel(o.status)}
                      </Badge>
                    </TableCell>
                    {!isPackingRole && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!o._tracking && (o.status === "pending" || o.status === "confirmed") && (
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => bookOnPostex(o.id)} disabled={postexBusy}>
                              <Truck className="h-3.5 w-3.5" /> Book
                            </Button>
                          )}
                          {transitions.length > 0 && (
                            <Select onValueChange={(v) => updateStatus(o.id, v)}>
                              <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue placeholder="Change status" />
                              </SelectTrigger>
                              <SelectContent>
                                {transitions.map(t => (
                                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Online Order</DialogTitle>
            <DialogDescription>Fill in the order details below.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{platforms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Platform Order ID</Label>
              <Input value={form.platform_order_id} onChange={e => setForm(p => ({ ...p, platform_order_id: e.target.value }))} placeholder="e.g. AMZ-12345" />
            </div>
            <div>
              <Label>Tracking Number</Label>
              <Input value={form.tracking_number} onChange={e => setForm(p => ({ ...p, tracking_number: e.target.value }))} placeholder="e.g. AWB001234" />
            </div>
            <div>
              <Label>Order Date</Label>
              <Input type="date" value={form.order_date} onChange={e => setForm(p => ({ ...p, order_date: e.target.value }))} />
            </div>
            <div>
              <Label>Customer Name *</Label>
              <Input value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.customer_phone} onChange={e => setForm(p => ({ ...p, customer_phone: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Shipping Address</Label>
              <Textarea value={form.shipping_address} onChange={e => setForm(p => ({ ...p, shipping_address: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} />
            </div>
            <div>
              <Label>Pincode</Label>
              <Input value={form.pincode} onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))} />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={form.payment_mode} onValueChange={v => setForm(p => ({ ...p, payment_mode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">Prepaid</SelectItem>
                  <SelectItem value="cod">COD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Order Value (Rs.)</Label>
              <Input type="number" value={form.order_value} onChange={e => setForm(p => ({ ...p, order_value: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Remarks</Label>
              <Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Weight update dialog with multiple items */}
      <Dialog open={weightDialogOpen} onOpenChange={v => { setWeightDialogOpen(v); if (!v) { setWeightOrder(null); setLiveWeight(""); setLiveItems([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Weight className="h-5 w-5" /> Scan & Weigh Parcel</DialogTitle>
            <DialogDescription>Add items, weight and quantity for this parcel.</DialogDescription>
          </DialogHeader>
          {weightOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Order:</span> <span className="font-medium">{weightOrder.order_number || weightOrder.platform_order_id}</span></div>
                <div><span className="text-muted-foreground">Customer:</span> <span className="font-medium">{weightOrder.customer_name}</span></div>
                <div><span className="text-muted-foreground">Tracking:</span> <span className="font-mono text-xs">{weightOrder.tracking_number || "-"}</span></div>
                <div><span className="text-muted-foreground">Booking Wt:</span> <span className="font-medium">{weightOrder.booking_weight ? `${weightOrder.booking_weight} g` : "-"}</span></div>
              </div>

              {/* Items list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Items in Parcel</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLiveItems(prev => [...prev, { itemId: "", qty: 1 }])}
                    className="gap-1 h-7 text-xs"
                  >
                    <Plus className="h-3 w-3" /> Add Item
                  </Button>
                </div>
                {liveItems.map((li, idx) => (
                  <div key={idx} className="flex gap-2 items-end">
                    <div className="flex-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Item</Label>}
                      <Select value={li.itemId} onValueChange={v => {
                        setLiveItems(prev => prev.map((item, i) => i === idx ? { ...item, itemId: v } : item));
                      }}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>
                          {onlineItems.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.code ? `${item.code} - ${item.name}` : item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Qty</Label>}
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={li.qty}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 1;
                          setLiveItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: val } : item));
                        }}
                        className="h-9"
                      />
                    </div>
                    {liveItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive"
                        onClick={() => setLiveItems(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <Label>Actual Weight (grams)</Label>
                <Input
                  type="number"
                  step="1"
                  value={liveWeight}
                  onChange={e => setLiveWeight(e.target.value)}
                  placeholder="e.g. 850"
                  autoFocus
                  className="text-lg font-semibold"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeightDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateWeight}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Scanner for weight */}
      <QRScannerDialog
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        onAssetScanned={handleWeightQRScanned}
        scannedCodes={scannedCodes}
      />
    </ERPLayout>
  );
}
