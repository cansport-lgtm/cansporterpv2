import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { ClipboardList, FileSpreadsheet, Plus, Search, Settings2, Users } from "lucide-react";
import * as XLSX from "xlsx";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PurchaseRequestTable, type PurchaseRequestListRow } from "@/components/purchase-request/PurchaseRequestTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PURCHASE_CATEGORY_OPTIONS, purchaseCategoryLabel, purchaseRequestRoleCategories } from "@/lib/purchase/categories";
import {
  PR_LIST_SELECT, PR_STATUS_META, errorMessage, fmtMoney, prDb, prStatusMeta,
} from "@/lib/purchaseRequest";

type View = "to_approve" | "final" | "to_order" | "all";
type Department = { id: string; name: string; code: string };
type HeadRow = { department_id: string; user_id: string; user: { full_name: string | null } | null };
type UserRow = { id: string; full_name: string; user_id: string };

/**
 * Purchase → Purchase Requests: every department's requests. Purchase
 * approvers work the "To approve" queue for their categories; super admins
 * give the final approval above the value limit and keep the settings
 * (approval limit, department heads).
 */
export default function PurchaseRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles, modulePermissions, purchaseCategoryPermissions, canViewPrices } = useAuth();
  const showPrices = canViewPrices();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const isPurchaseManager = isSuperAdmin || roles.some((r) => r.role === "purchase_manager");
  const roleNames = useMemo(() => roles.map((r) => r.role as string), [roles]);
  // Categories whose purchase approval this user gives (mirrors the database rule).
  const approveCategories = useMemo(
    () => isPurchaseManager
      ? PURCHASE_CATEGORY_OPTIONS.map((c) => c.value)
      : [...new Set([
          ...purchaseCategoryPermissions.filter((p) => p.can_approve).map((p) => p.category),
          ...purchaseRequestRoleCategories(roleNames, "approver"),
        ])],
    [isPurchaseManager, purchaseCategoryPermissions, roleNames],
  );
  // Who sees every category: the Purchase module's own people. A user whose only
  // Purchase access is a Purchase Request officer / approver role sees just its categories.
  const seesAll = isPurchaseManager
    || roleNames.some((r) => r === "purchase_officer" || r === "accounting_officer")
    || modulePermissions.some((p) => p.module_name === "purchase" && p.can_view);
  const visibleCategories = useMemo(
    () => seesAll ? PURCHASE_CATEGORY_OPTIONS.map((c) => c.value)
      : [...new Set([...approveCategories, ...purchaseRequestRoleCategories(roleNames, "officer")])],
    [seesAll, approveCategories, roleNames],
  );
  const categoryOptions = PURCHASE_CATEGORY_OPTIONS.filter((c) => visibleCategories.includes(c.value));

  const [view, setView] = useState<View>(approveCategories.length > 0 ? "to_approve" : "all");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 89), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [category, setCategory] = useState("all");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Open work is listed whatever its date; "All" is limited to the date range.
  const { data: open = [], isLoading: openLoading } = useQuery<PurchaseRequestListRow[]>({
    queryKey: ["purchase-requests", "open"],
    queryFn: async () => {
      const { data, error } = await prDb
        .from("purchase_requests")
        .select(PR_LIST_SELECT)
        .in("status", ["pending_hod", "pending_purchase", "pending_final", "approved", "partially_ordered"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: ranged = [], isLoading: rangedLoading } = useQuery<PurchaseRequestListRow[]>({
    queryKey: ["purchase-requests", "range", fromDate, toDate],
    enabled: view === "all",
    queryFn: async () => {
      const { data, error } = await prDb
        .from("purchase_requests")
        .select(PR_LIST_SELECT)
        .neq("status", "draft")
        .gte("request_date", fromDate)
        .lte("request_date", toDate)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["production-departments-active"],
    queryFn: async () => {
      const { data, error } = await prDb.from("production_departments").select("id, name, code, is_active").order("name");
      if (error) throw error;
      return (data ?? []).filter((d: { is_active: boolean | null }) => d.is_active !== false);
    },
  });

  const inScope = (r: PurchaseRequestListRow) => visibleCategories.includes(r.category);
  const queues = {
    to_approve: open.filter((r) => r.status === "pending_purchase" && approveCategories.includes(r.category)),
    final: open.filter((r) => r.status === "pending_final" && inScope(r)),
    to_order: open.filter((r) => (r.status === "approved" || r.status === "partially_ordered") && inScope(r)),
  };
  const base = view === "all" ? ranged.filter(inScope) : queues[view];
  const needle = search.trim().toLowerCase();
  const rows = base
    .filter((r) => category === "all" || r.category === category)
    .filter((r) => department === "all" || r.department_id === department)
    .filter((r) => view !== "all" || status === "all" || r.status === status)
    .filter((r) => !needle || [r.pr_number, r.purpose, r.department?.name, r.requester?.full_name]
      .some((x) => (x ?? "").toLowerCase().includes(needle)));

  const kpis = [
    { label: "With department heads", value: open.filter((r) => r.status === "pending_hod" && inScope(r)).length, tone: "text-amber-600" },
    { label: "Waiting for you", value: queues.to_approve.length, tone: "text-amber-600", view: "to_approve" as View },
    { label: "Final approval", value: queues.final.length, tone: "text-amber-600", view: "final" as View },
    { label: "Approved — to order", value: queues.to_order.length, tone: "text-emerald-600", view: "to_order" as View },
  ];

  const exportExcel = () => {
    const sheet = rows.map((r) => ({
      "PR no.": r.pr_number,
      Date: r.request_date,
      Category: purchaseCategoryLabel(r.category),
      Department: r.department?.name ?? "",
      "Requested by": r.requester?.full_name ?? "",
      Priority: r.priority === "urgent" ? (r.is_breakdown ? "Urgent — breakdown" : "Urgent") : "Normal",
      Purpose: r.purpose,
      "Required by": r.required_by ?? "",
      Items: r.purchase_request_items.length,
      ...(showPrices ? { "Est. value": Number(r.estimated_total) } : {}),
      Status: prStatusMeta(r.status).label,
      "Reject reason": r.reject_reason ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Purchase requests");
    XLSX.writeFile(wb, `purchase-requests-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Purchase Requests"
          description="Requests from every department: department head → Purchase → super admin above the value limit"
          icon={ClipboardList}
        >
          <Button variant="outline" onClick={exportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
          </Button>
          {isSuperAdmin && (
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-4 w-4 mr-1" /> Settings
            </Button>
          )}
          <Button onClick={() => navigate("/my-purchase-requests/new")}>
            <Plus className="h-4 w-4 mr-1" /> New purchase request
          </Button>
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Card key={k.label}
              className={cn("h-full", k.view && "cursor-pointer hover:border-primary/40 transition-colors", k.view === view && "border-primary/60")}
              onClick={() => k.view && setView(k.view)}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={cn("text-2xl font-display font-bold mt-1", k.tone)}>{openLoading ? "…" : k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="to_approve">To approve ({queues.to_approve.length})</TabsTrigger>
            <TabsTrigger value="final">Final approval ({queues.final.length})</TabsTrigger>
            <TabsTrigger value="to_order">Approved — to order ({queues.to_order.length})</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardContent className="p-3 md:p-4 flex flex-wrap items-end gap-3">
            {view === "all" && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" className="w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" className="w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {Object.entries(PR_STATUS_META).filter(([k]) => k !== "draft")
                        .map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categoryOptions.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs" htmlFor="pr-search">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input id="pr-search" className="pl-8" placeholder="PR no., purpose, department, requester…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <PurchaseRequestTable
              rows={rows}
              basePath="/purchase/requests"
              isLoading={view === "all" ? rangedLoading : openLoading}
              showPrices={showPrices}
              emptyText={view === "to_approve" && approveCategories.length === 0
                ? "You do not give purchase approval for any category."
                : "No purchase requests here."}
            />
          </CardContent>
        </Card>
      </div>

      {isSuperAdmin && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} departments={departments}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["purchase-request-settings"] })}
          notify={(title, description, bad) => toast({ title, description, variant: bad ? "destructive" : undefined })} />
      )}
    </ERPLayout>
  );
}

function SettingsDialog({
  open, onOpenChange, departments, onSaved, notify,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  departments: Department[];
  onSaved: () => void;
  notify: (title: string, description?: string, bad?: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const { data: limit } = useQuery<number>({
    queryKey: ["purchase-request-settings"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await prDb.from("purchase_request_settings").select("approval_limit").maybeSingle();
      if (error) throw error;
      return Number(data?.approval_limit ?? 0);
    },
  });
  const { data: heads = [] } = useQuery<HeadRow[]>({
    queryKey: ["purchase-request-department-heads"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await prDb
        .from("purchase_request_department_heads")
        .select("department_id, user_id, user:app_users!purchase_request_department_heads_user_id_fkey(full_name)");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["app-users-active-min"],
    enabled: Boolean(editDept),
    queryFn: async () => {
      const { data, error } = await prDb.from("app_users").select("id, full_name, user_id").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveLimit = useMutation({
    mutationFn: async () => {
      const { error } = await prDb.rpc("purchase_request_settings_save", { p_approval_limit: limitDraft === "" ? null : Number(limitDraft) });
      if (error) throw error;
    },
    onSuccess: () => { setLimitDraft(null); onSaved(); notify("Approval limit saved"); },
    onError: (e) => notify("Could not save", errorMessage(e), true),
  });
  const saveHeads = useMutation({
    mutationFn: async () => {
      const { error } = await prDb.rpc("purchase_request_set_department_heads", { p_department_id: editDept?.id, p_user_ids: picked });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-request-department-heads"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-request-my-head-departments"] });
      setEditDept(null);
      notify("Department heads saved");
    },
    onError: (e) => notify("Could not save", errorMessage(e), true),
  });

  const headsOf = (deptId: string) => heads.filter((h) => h.department_id === deptId);
  const needle = userSearch.trim().toLowerCase();

  return (
    <>
      <Dialog open={open && !editDept} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase request settings</DialogTitle>
            <DialogDescription>Only a super admin changes these.</DialogDescription>
          </DialogHeader>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Approval limit</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                A request whose estimated value is above this needs a super admin's final approval after Purchase approves it.
              </p>
              <div className="flex gap-2 items-end">
                <div className="space-y-1">
                  <Label htmlFor="pr-limit" className="text-xs">Limit</Label>
                  <Input id="pr-limit" type="number" min="0" step="any" className="w-48"
                    value={limitDraft ?? (limit !== undefined ? String(limit) : "")}
                    onChange={(e) => setLimitDraft(e.target.value)} />
                </div>
                <Button onClick={() => saveLimit.mutate()} disabled={limitDraft === null || saveLimit.isPending}>Save</Button>
                {limit !== undefined && <span className="text-sm text-muted-foreground pb-2">Now {fmtMoney(limit)}</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Department heads</CardTitle></CardHeader>
            <CardContent className="p-0">
              <p className="text-xs text-muted-foreground px-4 pb-2">
                The first approval of every request. A department without a head cannot submit requests; a head's own requests skip this step.
              </p>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Department</TableHead><TableHead>Heads</TableHead><TableHead className="w-20" /></TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((d) => {
                    const hs = headsOf(d.id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="text-sm font-medium">{d.name}</TableCell>
                        <TableCell className="text-sm">
                          {hs.length ? hs.map((h) => h.user?.full_name ?? "?").join(", ") : <span className="text-amber-700">Not set</span>}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => { setEditDept(d); setPicked(hs.map((h) => h.user_id)); setUserSearch(""); }}>
                            <Users className="h-3.5 w-3.5 mr-1" /> Set
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editDept)} onOpenChange={(v) => !v && setEditDept(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Heads of {editDept?.name}</DialogTitle>
            <DialogDescription>Any one of them can approve the department's requests.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Search users…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {users
              .filter((u) => picked.includes(u.id) || !needle || `${u.full_name} ${u.user_id}`.toLowerCase().includes(needle))
              .map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                  <Checkbox checked={picked.includes(u.id)}
                    onCheckedChange={(v) => setPicked((p) => v === true ? [...p, u.id] : p.filter((x) => x !== u.id))} />
                  <span>{u.full_name}</span>
                  <span className="text-xs text-muted-foreground">{u.user_id}</span>
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDept(null)}>Back</Button>
            <Button onClick={() => saveHeads.mutate()} disabled={saveHeads.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
