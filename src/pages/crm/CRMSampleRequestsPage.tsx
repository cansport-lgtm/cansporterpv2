import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Plus, RefreshCw, CheckCircle2, XCircle, Truck, PackageCheck, Eye, Trash2, X, AlertCircle, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type Status = "Requested" | "Approved" | "Rejected" | "Issued" | "Delivered" | "Cancelled";
type RecipientType = "lead" | "contact" | "customer";

interface SampleItem { id: string; product_id: string; variant_id: string | null; sku: string | null; unit: string; }
interface Product { id: string; name: string; brand: string | null; }
interface Variant { id: string; variant_name: string; }
interface Lead { id: string; name: string; company: string | null; phone: string | null; email: string | null; }
interface Contact { id: string; full_name: string; company: string | null; phone: string | null; email: string | null; customer_id: string | null; }
interface Customer { id: string; name: string; contact_person: string | null; phone: string | null; city: string | null; area: string | null; address: string | null; }

interface Request {
  id: string;
  request_number: string | null;
  request_date: string;
  requested_by: string | null;
  recipient_type: RecipientType;
  lead_id: string | null;
  contact_id: string | null;
  customer_id: string | null;
  recipient_name: string | null;
  recipient_company: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_area: string | null;
  purpose: string | null;
  notes: string | null;
  status: Status;
  approved_by: string | null; approved_at: string | null; rejection_reason: string | null;
  issued_by: string | null; issued_at: string | null;
  courier_name: string | null; tracking_number: string | null; expected_delivery_date: string | null;
  delivered_at: string | null; delivery_remarks: string | null;
  created_at: string;
}
interface RequestItem { id: string; request_id: string; sample_item_id: string; quantity: number; remarks: string | null; }

const todayStr = () => new Date().toISOString().slice(0, 10);

const statusColor = (s: Status) => {
  switch (s) {
    case "Requested": return "bg-slate-100 text-slate-800 border-slate-300";
    case "Approved": return "bg-blue-100 text-blue-800 border-blue-300";
    case "Rejected": return "bg-red-100 text-red-800 border-red-300";
    case "Issued": return "bg-amber-100 text-amber-800 border-amber-300";
    case "Delivered": return "bg-green-100 text-green-800 border-green-300";
    case "Cancelled": return "bg-gray-200 text-gray-700 border-gray-300";
  }
};

const emptyLine = () => ({ sample_item_id: "", quantity: 1, remarks: "" });

export default function CRMSampleRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [sampleItems, setSampleItems] = useState<SampleItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stockByItem, setStockByItem] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create/Edit dialog
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Request | null>(null);
  const [form, setForm] = useState({
    request_date: todayStr(),
    recipient_type: "customer" as RecipientType,
    recipient_id: "",
    purpose: "",
    notes: "",
  });
  const [lines, setLines] = useState<{ sample_item_id: string; quantity: number; remarks: string }[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  // View dialog
  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState<Request | null>(null);

  // Action dialogs
  const [actionOpen, setActionOpen] = useState(false);
  const [action, setAction] = useState<"approve" | "reject" | "issue" | "deliver" | "cancel" | null>(null);
  const [actionTarget, setActionTarget] = useState<Request | null>(null);
  const [actionFields, setActionFields] = useState<any>({});

  const prodMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const varMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants]);
  const siMap = useMemo(() => Object.fromEntries(sampleItems.map(s => [s.id, s])), [sampleItems]);

  const load = async () => {
    setLoading(true);
    const [rq, ri, si, pr, vr, ld, ct, cu, mv] = await Promise.all([
      supabase.from("crm_sample_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_sample_request_items").select("*"),
      supabase.from("crm_sample_items").select("id,product_id,variant_id,sku,unit").eq("is_active", true),
      supabase.from("crm_products").select("id,name,brand"),
      supabase.from("crm_product_variants").select("id,variant_name"),
      supabase.from("crm_leads").select("id,name,company,phone,email").order("name"),
      supabase.from("crm_contacts").select("id,full_name,company,phone,email,customer_id").order("full_name"),
      supabase.from("customers").select("id,name,contact_person,phone,city,area,address").eq("is_active", true).order("name"),
      supabase.from("crm_sample_stock_movements").select("sample_item_id,quantity"),
    ]);
    if (rq.error) toast.error(rq.error.message);
    setRequests((rq.data as any) || []);
    setItems((ri.data as any) || []);
    setSampleItems((si.data as any) || []);
    setProducts((pr.data as any) || []);
    setVariants((vr.data as any) || []);
    setLeads((ld.data as any) || []);
    setContacts((ct.data as any) || []);
    setCustomers((cu.data as any) || []);
    const stock: Record<string, number> = {};
    ((mv.data as any[]) || []).forEach((m) => { stock[m.sample_item_id] = (stock[m.sample_item_id] || 0) + Number(m.quantity); });
    setStockByItem(stock);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const sampleItemLabel = (id: string) => {
    const si = siMap[id];
    if (!si) return "—";
    const p = prodMap[si.product_id]?.name || "—";
    const v = si.variant_id ? ` / ${varMap[si.variant_id]?.variant_name || ""}` : "";
    return `${p}${v}${si.sku ? ` (${si.sku})` : ""}`;
  };

  const itemsByRequest = useMemo(() => {
    const m: Record<string, RequestItem[]> = {};
    items.forEach(i => { (m[i.request_id] = m[i.request_id] || []).push(i); });
    return m;
  }, [items]);

  // ---------- Gate Pass print ----------
  const printGatePass = (r: Request) => {
    const its = itemsByRequest[r.id] || [];
    const rows = its.map((i, idx) => {
      const si = siMap[i.sample_item_id];
      const prod = si ? (prodMap[si.product_id]?.name || "—") : "—";
      const variant = si?.variant_id ? (varMap[si.variant_id]?.variant_name || "") : "";
      const sku = si?.sku || "—";
      const unit = si?.unit || "";
      return `<tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${sku}</td>
        <td>${prod}</td>
        <td>${variant || "—"}</td>
        <td style="text-align:center">${unit}</td>
        <td style="text-align:right"><b>${Number(i.quantity)}</b></td>
        <td>${i.remarks || ""}</td>
      </tr>`;
    }).join("");
    const totalQty = its.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const issuedOn = r.issued_at ? new Date(r.issued_at).toLocaleString() : new Date().toLocaleString();
    const w = window.open("", "_blank");
    if (!w) { toast.error("Allow popups to print"); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Gate Pass - ${r.request_number || ""}</title>
<style>
  @page { size: A5 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 0; }
  .pass { width: 100%; }
  .hdr { text-align: center; border-bottom: 2px solid #000; padding-bottom: 4mm; margin-bottom: 4mm; }
  .hdr h2 { margin: 0; font-size: 13px; letter-spacing: 1px; }
  .hdr h1 { margin: 2px 0 0; font-size: 17px; letter-spacing: 3px; }
  .meta { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 11px; }
  .meta b { font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 3mm; }
  .box { border: 1px solid #888; padding: 2.5mm 3mm; }
  .box .lbl { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { border: 1px solid #888; padding: 1.6mm 2mm; }
  th { background: #eee; text-align: left; font-size: 10px; }
  .tot td { background: #f4f4f4; font-weight: 700; }
  .purpose { margin-top: 3mm; border: 1px dashed #888; padding: 2mm 3mm; font-size: 10.5px; min-height: 9mm; }
  .signs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6mm; margin-top: 6mm; }
  .sign { text-align: center; font-size: 10px; }
  .sign .line { border-top: 1px solid #000; margin-top: 14mm; padding-top: 1.5mm; }
  .note { margin-top: 3mm; font-size: 9px; color: #555; text-align: center; font-style: italic; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <div class="pass">
    <div class="hdr">
      <h2>CANSPORT GLOBAL INDUSTRIES</h2>
      <h1>SAMPLE GATE PASS</h1>
      <div class="meta">
        <div><b>No:</b> ${r.request_number || "—"}</div>
        <div><b>Status:</b> ${r.status}</div>
        <div><b>Issue Date:</b> ${issuedOn}</div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <div class="lbl">From (Issued By)</div>
        <div><b>${r.issued_by || user?.full_name || "—"}</b></div>
        <div>Department: CRM / Samples</div>
        <div>Approved By: ${r.approved_by || "—"}</div>
      </div>
      <div class="box">
        <div class="lbl">To (Recipient)</div>
        <div><b>${r.recipient_name || "—"}</b>${r.recipient_company ? ` — ${r.recipient_company}` : ""}</div>
        <div>${r.recipient_phone || ""}</div>
        <div>${r.recipient_address || ""}${r.recipient_city ? `, ${r.recipient_city}` : ""}${r.recipient_area ? ` (${r.recipient_area})` : ""}</div>
        ${r.courier_name ? `<div>Courier: <b>${r.courier_name}</b> ${r.tracking_number ? `· ${r.tracking_number}` : ""}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr>
        <th style="width:8mm;text-align:center">#</th>
        <th>SKU</th>
        <th>Item / Product</th>
        <th>Variant</th>
        <th style="text-align:center;width:14mm">Unit</th>
        <th style="text-align:right;width:16mm">Qty</th>
        <th>Remarks</th>
      </tr></thead>
      <tbody>
        ${rows || `<tr><td colspan="7" style="text-align:center;padding:6mm">No items</td></tr>`}
        <tr class="tot">
          <td colspan="5" style="text-align:right">TOTAL</td>
          <td style="text-align:right">${totalQty}</td>
          <td>${its.length} line(s)</td>
        </tr>
      </tbody>
    </table>
    <div class="purpose"><b>Purpose / Notes:</b> ${[r.purpose, r.notes].filter(Boolean).join(" — ") || "—"}</div>
    <div class="signs">
      <div class="sign"><div class="line">Issued By (Sign)</div></div>
      <div class="sign"><div class="line">Security / Gate</div></div>
      <div class="sign"><div class="line">Receiver Sign &amp; Stamp</div></div>
    </div>
    <div class="note">This pass authorises the listed sample items to leave the premises. Please present at the gate.</div>
  </div>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  };


  // ---------- Create ----------
  const openNew = () => {
    setEditing(null);
    setForm({ request_date: todayStr(), recipient_type: "customer", recipient_id: "", purpose: "", notes: "" });
    setLines([emptyLine()]);
    setOpen(true);
  };

  const openEditDraft = (r: Request) => {
    if (r.status !== "Requested") { toast.error("Only Requested can be edited"); return; }
    setEditing(r);
    setForm({
      request_date: r.request_date,
      recipient_type: r.recipient_type,
      recipient_id: r.lead_id || r.contact_id || r.customer_id || "",
      purpose: r.purpose || "",
      notes: r.notes || "",
    });
    const ls = (itemsByRequest[r.id] || []).map(i => ({ sample_item_id: i.sample_item_id, quantity: Number(i.quantity), remarks: i.remarks || "" }));
    setLines(ls.length ? ls : [emptyLine()]);
    setOpen(true);
  };

  const buildRecipientSnapshot = () => {
    const t = form.recipient_type;
    const id = form.recipient_id;
    if (!id) return null;
    if (t === "lead") {
      const l = leads.find(x => x.id === id);
      if (!l) return null;
      return { lead_id: id, contact_id: null, customer_id: null, recipient_name: l.name, recipient_company: l.company, recipient_phone: l.phone, recipient_address: null, recipient_city: null, recipient_area: null };
    }
    if (t === "contact") {
      const c = contacts.find(x => x.id === id);
      if (!c) return null;
      const cust = c.customer_id ? customers.find(x => x.id === c.customer_id) : null;
      return { lead_id: null, contact_id: id, customer_id: c.customer_id, recipient_name: c.full_name, recipient_company: c.company || cust?.name || null, recipient_phone: c.phone || cust?.phone || null, recipient_address: cust?.address || null, recipient_city: cust?.city || null, recipient_area: cust?.area || null };
    }
    const cu = customers.find(x => x.id === id);
    if (!cu) return null;
    return { lead_id: null, contact_id: null, customer_id: id, recipient_name: cu.contact_person || cu.name, recipient_company: cu.name, recipient_phone: cu.phone, recipient_address: cu.address, recipient_city: cu.city, recipient_area: cu.area };
  };

  const saveRequest = async () => {
    const snap = buildRecipientSnapshot();
    if (!snap) { toast.error("Pick a recipient"); return; }
    const validLines = lines.filter(l => l.sample_item_id && Number(l.quantity) > 0);
    if (!validLines.length) { toast.error("Add at least one sample item"); return; }
    setSaving(true);

    const header = {
      request_date: form.request_date,
      recipient_type: form.recipient_type,
      ...snap,
      purpose: form.purpose || null,
      notes: form.notes || null,
      requested_by: editing?.requested_by || user?.full_name || null,
      requested_by_user_id: editing?.requested_by ? undefined : user?.id || null,
    };

    let reqId: string;
    if (editing) {
      const { error } = await supabase.from("crm_sample_requests").update(header).eq("id", editing.id);
      if (error) { setSaving(false); toast.error(error.message); return; }
      reqId = editing.id;
      await supabase.from("crm_sample_request_items").delete().eq("request_id", reqId);
    } else {
      const { data, error } = await supabase.from("crm_sample_requests").insert(header).select("id").single();
      if (error || !data) { setSaving(false); toast.error(error?.message || "Failed"); return; }
      reqId = data.id;
    }

    const payload = validLines.map(l => ({ request_id: reqId, sample_item_id: l.sample_item_id, quantity: Number(l.quantity), remarks: l.remarks || null }));
    const { error: e2 } = await supabase.from("crm_sample_request_items").insert(payload);
    setSaving(false);
    if (e2) { toast.error(e2.message); return; }
    toast.success("Saved");
    setOpen(false);
    load();
  };

  // ---------- Actions ----------
  const openAction = (a: typeof action, r: Request) => {
    setAction(a);
    setActionTarget(r);
    setActionFields(a === "issue" ? { issued_at: new Date().toISOString().slice(0, 10), courier_name: "", tracking_number: "", expected_delivery_date: "" }
                  : a === "deliver" ? { delivered_at: new Date().toISOString().slice(0, 10), delivery_remarks: "" }
                  : a === "reject" ? { rejection_reason: "" }
                  : {});
    setActionOpen(true);
  };

  const runAction = async () => {
    if (!action || !actionTarget) return;
    let upd: any = {};
    const now = new Date().toISOString();
    const userName = user?.full_name || null;
    if (action === "approve") upd = { status: "Approved", approved_by: userName, approved_at: now };
    if (action === "reject") {
      if (!actionFields.rejection_reason?.trim()) { toast.error("Reason required"); return; }
      upd = { status: "Rejected", approved_by: userName, approved_at: now, rejection_reason: actionFields.rejection_reason };
    }
    if (action === "issue") {
      // Check stock
      const reqItems = itemsByRequest[actionTarget.id] || [];
      for (const ri of reqItems) {
        const stk = stockByItem[ri.sample_item_id] || 0;
        if (Number(ri.quantity) > stk) {
          if (!confirm(`Insufficient stock for ${sampleItemLabel(ri.sample_item_id)} (have ${stk}, need ${ri.quantity}). Issue anyway?`)) return;
          break;
        }
      }
      upd = {
        status: "Issued",
        issued_by: userName,
        issued_at: actionFields.issued_at ? new Date(actionFields.issued_at).toISOString() : now,
        courier_name: actionFields.courier_name || null,
        tracking_number: actionFields.tracking_number || null,
        expected_delivery_date: actionFields.expected_delivery_date || null,
      };
    }
    if (action === "deliver") upd = { status: "Delivered", delivered_at: actionFields.delivered_at ? new Date(actionFields.delivered_at).toISOString() : now, delivery_remarks: actionFields.delivery_remarks || null };
    if (action === "cancel") upd = { status: "Cancelled" };

    const { error } = await supabase.from("crm_sample_requests").update(upd).eq("id", actionTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Updated");
    setActionOpen(false);
    // Auto open gate pass print after issuing
    if (action === "issue") {
      const updated = { ...actionTarget, ...upd } as Request;
      setTimeout(() => printGatePass(updated), 200);
    }
    load();
  };

  const removeRequest = async (r: Request) => {
    if (r.status !== "Requested" && r.status !== "Cancelled" && r.status !== "Rejected") { toast.error("Cannot delete after approval/issue"); return; }
    if (!confirm("Delete this request?")) return;
    const { error } = await supabase.from("crm_sample_requests").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    load();
  };

  // ---------- Filtering ----------
  const filtered = requests.filter(r => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.request_number || "").toLowerCase().includes(q) ||
      (r.recipient_name || "").toLowerCase().includes(q) ||
      (r.recipient_company || "").toLowerCase().includes(q) ||
      (r.requested_by || "").toLowerCase().includes(q)
    );
  });

  // ---------- Aggregations for tabs ----------
  const byRecipient = useMemo(() => {
    const m: Record<string, Request[]> = {};
    requests.forEach(r => {
      const key = `${r.recipient_company || r.recipient_name || "Unknown"} — ${r.recipient_name || ""}`;
      (m[key] = m[key] || []).push(r);
    });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [requests]);

  const byRequester = useMemo(() => {
    const m: Record<string, Request[]> = {};
    requests.forEach(r => { const k = r.requested_by || "—"; (m[k] = m[k] || []).push(r); });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [requests]);

  const ageingRows = useMemo(() => {
    const now = Date.now();
    return requests
      .filter(r => r.status === "Issued" && r.issued_at)
      .map(r => ({ r, days: Math.floor((now - new Date(r.issued_at!).getTime()) / 86400000) }))
      .filter(x => x.days > 0)
      .sort((a, b) => b.days - a.days);
  }, [requests]);

  // ---------- Render helpers ----------
  const recipientOptions = () => {
    if (form.recipient_type === "lead") return leads.map(l => ({ id: l.id, label: `${l.name}${l.company ? ` — ${l.company}` : ""}` }));
    if (form.recipient_type === "contact") return contacts.map(c => ({ id: c.id, label: `${c.full_name}${c.company ? ` — ${c.company}` : ""}` }));
    return customers.map(c => ({ id: c.id, label: `${c.name}${c.city ? ` (${c.city})` : ""}` }));
  };

  return (
    <ERPLayout>
      <PageHeader title="Sample Requests" description="Request, approve, issue & track product samples" />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Requests</TabsTrigger>
          <TabsTrigger value="by_recipient">By Recipient</TabsTrigger>
          <TabsTrigger value="by_requester">By Requester</TabsTrigger>
          <TabsTrigger value="ageing">Ageing (Issued)</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <div className="flex flex-wrap items-center gap-2 mb-3 mt-2">
            <Input placeholder="Search number / recipient..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(["Requested", "Approved", "Issued", "Delivered", "Rejected", "Cancelled"] as Status[]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
              <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />New Request</Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={8} className="text-center p-6">Loading...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center p-6 text-muted-foreground">No requests</TableCell></TableRow>
                  ) : filtered.map(r => {
                    const its = itemsByRequest[r.id] || [];
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.request_number}</TableCell>
                        <TableCell>{r.request_date}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.recipient_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.recipient_company} {r.recipient_city ? `· ${r.recipient_city}` : ""}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.requested_by || "—"}</TableCell>
                        <TableCell>
                          <div className="text-xs">{its.length} item(s)</div>
                          <div className="text-xs text-muted-foreground">{its.slice(0, 2).map(i => `${i.quantity}× ${sampleItemLabel(i.sample_item_id)}`).join(", ")}{its.length > 2 ? ` +${its.length - 2}` : ""}</div>
                        </TableCell>
                        <TableCell><Badge className={statusColor(r.status)}>{r.status}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {r.issued_at ? new Date(r.issued_at).toLocaleDateString() : "—"}
                          {r.courier_name ? <div className="text-muted-foreground">{r.courier_name} {r.tracking_number}</div> : null}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="icon" variant="ghost" onClick={() => { setViewing(r); setViewOpen(true); }}><Eye className="h-4 w-4" /></Button>
                          {(r.status === "Approved" || r.status === "Issued" || r.status === "Delivered") && (
                            <Button size="sm" variant="ghost" className="text-slate-700" title="Print Gate Pass" onClick={() => printGatePass(r)}><Printer className="h-4 w-4 mr-1" />Gate Pass</Button>
                          )}
                          {r.status === "Requested" && <>
                            <Button size="sm" variant="ghost" onClick={() => openEditDraft(r)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="text-green-700" onClick={() => openAction("approve", r)}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
                            <Button size="sm" variant="ghost" className="text-red-700" onClick={() => openAction("reject", r)}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                          </>}
                          {r.status === "Approved" && <Button size="sm" variant="ghost" className="text-amber-700" onClick={() => openAction("issue", r)}><Truck className="h-4 w-4 mr-1" />Issue</Button>}
                          {r.status === "Issued" && <Button size="sm" variant="ghost" className="text-green-700" onClick={() => openAction("deliver", r)}><PackageCheck className="h-4 w-4 mr-1" />Delivered</Button>}
                          {(r.status === "Requested" || r.status === "Approved") && <Button size="sm" variant="ghost" onClick={() => openAction("cancel", r)}>Cancel</Button>}
                          {(r.status === "Requested" || r.status === "Cancelled" || r.status === "Rejected") && <Button size="icon" variant="ghost" onClick={() => removeRequest(r)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by_recipient">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead className="text-right">Total Requests</TableHead><TableHead>Status Breakdown</TableHead><TableHead>Last Request</TableHead></TableRow></TableHeader>
              <TableBody>
                {byRecipient.map(([key, rs]) => {
                  const counts: Record<string, number> = {};
                  rs.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
                  const last = rs.map(r => r.request_date).sort().reverse()[0];
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell className="text-right">{rs.length}</TableCell>
                      <TableCell className="space-x-1">
                        {Object.entries(counts).map(([s, n]) => <Badge key={s} className={statusColor(s as Status)}>{s}: {n}</Badge>)}
                      </TableCell>
                      <TableCell className="text-xs">{last}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="by_requester">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Requester</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status Breakdown</TableHead></TableRow></TableHeader>
              <TableBody>
                {byRequester.map(([key, rs]) => {
                  const counts: Record<string, number> = {};
                  rs.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell className="text-right">{rs.length}</TableCell>
                      <TableCell className="space-x-1">{Object.entries(counts).map(([s, n]) => <Badge key={s} className={statusColor(s as Status)}>{s}: {n}</Badge>)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="ageing">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Recipient</TableHead><TableHead>Issued</TableHead><TableHead className="text-right">Days Pending</TableHead><TableHead>Courier</TableHead></TableRow></TableHeader>
              <TableBody>
                {ageingRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center p-6 text-muted-foreground">No issued-but-undelivered samples</TableCell></TableRow>
                ) : ageingRows.map(({ r, days }) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.request_number}</TableCell>
                    <TableCell>{r.recipient_name} <span className="text-xs text-muted-foreground">{r.recipient_company}</span></TableCell>
                    <TableCell className="text-xs">{r.issued_at ? new Date(r.issued_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className={`text-right font-bold ${days > 7 ? "text-red-600" : days > 3 ? "text-amber-600" : ""}`}>{days}d</TableCell>
                    <TableCell className="text-xs">{r.courier_name} {r.tracking_number}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* New / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.request_number}` : "New Sample Request"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Request Date</Label>
                <Input type="date" value={form.request_date} onChange={(e) => setForm({ ...form, request_date: e.target.value })} />
              </div>
              <div>
                <Label>Requested By</Label>
                <Input value={editing?.requested_by || user?.full_name || ""} disabled />
              </div>
            </div>

            <div>
              <Label>Recipient Type</Label>
              <RadioGroup value={form.recipient_type} onValueChange={(v: any) => setForm({ ...form, recipient_type: v, recipient_id: "" })} className="flex gap-4 mt-1">
                <label className="flex items-center gap-2"><RadioGroupItem value="customer" /> Customer</label>
                <label className="flex items-center gap-2"><RadioGroupItem value="lead" /> CRM Lead</label>
                <label className="flex items-center gap-2"><RadioGroupItem value="contact" /> CRM Contact</label>
              </RadioGroup>
            </div>

            <div>
              <Label>Recipient *</Label>
              <Select value={form.recipient_id} onValueChange={(v) => setForm({ ...form, recipient_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select recipient" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {recipientOptions().map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Purpose</Label>
                <Input placeholder="Demo at meeting, trial order..." value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Sample Items *</Label>
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, emptyLine()])}><Plus className="h-3 w-3 mr-1" />Add Row</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-20">Stock</TableHead><TableHead>Remarks</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {lines.map((l, idx) => {
                    const stk = l.sample_item_id ? (stockByItem[l.sample_item_id] || 0) : null;
                    const low = stk !== null && Number(l.quantity) > stk;
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select value={l.sample_item_id} onValueChange={(v) => { const c = [...lines]; c[idx].sample_item_id = v; setLines(c); }}>
                            <SelectTrigger><SelectValue placeholder="Pick sample" /></SelectTrigger>
                            <SelectContent>
                              {sampleItems.map(si => <SelectItem key={si.id} value={si.id}>{sampleItemLabel(si.id)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" min={1} value={l.quantity} onChange={(e) => { const c = [...lines]; c[idx].quantity = Number(e.target.value); setLines(c); }} /></TableCell>
                        <TableCell className={`text-sm ${low ? "text-red-600 font-bold" : ""}`}>{stk ?? "—"}{low && <AlertCircle className="inline h-3 w-3 ml-1" />}</TableCell>
                        <TableCell><Input value={l.remarks} onChange={(e) => { const c = [...lines]; c[idx].remarks = e.target.value; setLines(c); }} /></TableCell>
                        <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== idx))}><X className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={saveRequest} disabled={saving}>{saving ? "Saving..." : "Save Request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle className="flex items-center justify-between gap-3">
            <span>{viewing?.request_number}</span>
            {viewing && (viewing.status === "Approved" || viewing.status === "Issued" || viewing.status === "Delivered") && (
              <Button size="sm" variant="outline" onClick={() => printGatePass(viewing)}><Printer className="h-4 w-4 mr-1" />Print Gate Pass</Button>
            )}
          </DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><Badge className={statusColor(viewing.status)}>{viewing.status}</Badge><span className="text-muted-foreground">{viewing.request_date}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Requested By:</span> {viewing.requested_by || "—"}</div>
                <div><span className="text-muted-foreground">Type:</span> {viewing.recipient_type}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Recipient:</span> <b>{viewing.recipient_name}</b> {viewing.recipient_company ? `(${viewing.recipient_company})` : ""}</div>
                <div><span className="text-muted-foreground">Phone:</span> {viewing.recipient_phone || "—"}</div>
                <div><span className="text-muted-foreground">City/Area:</span> {viewing.recipient_city || "—"} {viewing.recipient_area ? `· ${viewing.recipient_area}` : ""}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Address:</span> {viewing.recipient_address || "—"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Purpose:</span> {viewing.purpose || "—"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> {viewing.notes || "—"}</div>
              </div>
              <div>
                <div className="font-medium mb-1">Items</div>
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(itemsByRequest[viewing.id] || []).map(i => (
                      <TableRow key={i.id}><TableCell>{sampleItemLabel(i.sample_item_id)}</TableCell><TableCell className="text-right">{i.quantity}</TableCell><TableCell className="text-xs">{i.remarks || "—"}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {viewing.approved_at && <div className="text-xs"><b>Approved:</b> {new Date(viewing.approved_at).toLocaleString()} by {viewing.approved_by}</div>}
              {viewing.rejection_reason && <div className="text-xs text-red-700"><b>Rejection:</b> {viewing.rejection_reason}</div>}
              {viewing.issued_at && <div className="text-xs"><b>Issued:</b> {new Date(viewing.issued_at).toLocaleString()} by {viewing.issued_by} {viewing.courier_name ? `via ${viewing.courier_name} (${viewing.tracking_number})` : ""}</div>}
              {viewing.delivered_at && <div className="text-xs"><b>Delivered:</b> {new Date(viewing.delivered_at).toLocaleString()} — {viewing.delivery_remarks}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Action dialog */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader><DialogTitle>
            {action === "approve" ? "Approve Request" : action === "reject" ? "Reject Request" : action === "issue" ? "Issue Samples" : action === "deliver" ? "Mark Delivered" : "Cancel Request"}
          </DialogTitle></DialogHeader>
          <div className="space-y-3">
            {action === "approve" && <div className="text-sm">This will mark the request as Approved. You can then issue the samples.</div>}
            {action === "cancel" && <div className="text-sm">Cancel this request? This action can be undone only by creating a new request.</div>}
            {action === "reject" && (
              <div><Label>Reason *</Label><Textarea value={actionFields.rejection_reason || ""} onChange={(e) => setActionFields({ ...actionFields, rejection_reason: e.target.value })} rows={3} /></div>
            )}
            {action === "issue" && (
              <>
                <div><Label>Issue Date</Label><Input type="date" value={actionFields.issued_at || ""} onChange={(e) => setActionFields({ ...actionFields, issued_at: e.target.value })} /></div>
                <div><Label>Courier</Label><Input value={actionFields.courier_name || ""} onChange={(e) => setActionFields({ ...actionFields, courier_name: e.target.value })} /></div>
                <div><Label>Tracking Number</Label><Input value={actionFields.tracking_number || ""} onChange={(e) => setActionFields({ ...actionFields, tracking_number: e.target.value })} /></div>
                <div><Label>Expected Delivery</Label><Input type="date" value={actionFields.expected_delivery_date || ""} onChange={(e) => setActionFields({ ...actionFields, expected_delivery_date: e.target.value })} /></div>
                <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">Issuing will automatically deduct from sample stock.</div>
              </>
            )}
            {action === "deliver" && (
              <>
                <div><Label>Delivered Date</Label><Input type="date" value={actionFields.delivered_at || ""} onChange={(e) => setActionFields({ ...actionFields, delivered_at: e.target.value })} /></div>
                <div><Label>Remarks</Label><Textarea value={actionFields.delivery_remarks || ""} onChange={(e) => setActionFields({ ...actionFields, delivery_remarks: e.target.value })} rows={2} /></div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>Close</Button>
            <Button onClick={runAction}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
