import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/shared/MetricCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardCheck, Plus, Eye, CheckCircle, AlertTriangle, Search, Printer, QrCode, ScanLine, Calendar, Clock, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { format, addMonths, addWeeks, isPast, isToday } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { AssetQRLabels } from "@/components/fixed-assets/AssetQRLabels";
import { QRScannerDialog } from "@/components/fixed-assets/QRScannerDialog";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  approved: "bg-purple-100 text-purple-800",
};

const physicalStatusColors: Record<string, string> = {
  not_verified: "bg-muted text-muted-foreground",
  found: "bg-green-100 text-green-800",
  missing: "bg-red-100 text-red-800",
  damaged: "bg-orange-100 text-orange-800",
  location_mismatch: "bg-yellow-100 text-yellow-800",
};

const physicalStatusLabels: Record<string, string> = {
  not_verified: "Not Verified",
  found: "Found",
  missing: "Missing",
  damaged: "Damaged",
  location_mismatch: "Location Mismatch",
};

const enumCategoryLabels: Record<string, string> = {
  office_assets: "Office Assets",
  production_machinery: "Production Machinery",
  molds_dies: "Molds & Dies",
  machine_spare_parts: "Machine Spare Parts",
};

function getAssetDisplayCategory(asset: any): string {
  if (asset.custom_category) return asset.custom_category;
  if (asset.category) return enumCategoryLabels[asset.category] || asset.category;
  return "Uncategorized";
}

export default function AssetReconciliationPage() {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedReconciliation, setSelectedReconciliation] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRemarks, setNewRemarks] = useState("");
  const [newCategory, setNewCategory] = useState<string>("all");
  const [showQRLabels, setShowQRLabels] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [scanSessionCodes, setScanSessionCodes] = useState<string[]>([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleCategory, setScheduleCategory] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState("monthly");
  const [scheduleNextDate, setScheduleNextDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [scheduleRemarks, setScheduleRemarks] = useState("");

  // Fetch reconciliations
  const { data: reconciliations = [] } = useQuery({
    queryKey: ["asset-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_reconciliations")
        .select("*, conducted_by_user:app_users!asset_reconciliations_conducted_by_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch all active assets for QR labels
  const { data: allAssets = [] } = useQuery({
    queryKey: ["all-active-assets-for-qr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("id, asset_code, name, category, custom_category, location_description")
        .or("status.eq.active,status.eq.under_maintenance")
        .order("asset_code");
      if (error) throw error;
      return data;
    },
  });

  // Get unique categories from assets
  const assetCategories = (() => {
    const cats = new Set<string>();
    allAssets.forEach((a: any) => cats.add(getAssetDisplayCategory(a)));
    return Array.from(cats).sort();
  })();

  // Fetch reconciliation items when detail is open
  const { data: reconciliationItems = [] } = useQuery({
    queryKey: ["asset-reconciliation-items", selectedReconciliation?.id],
    queryFn: async () => {
      if (!selectedReconciliation) return [];
      const { data, error } = await supabase
        .from("asset_reconciliation_items")
        .select("*, fixed_assets(asset_code, name, category, custom_category, production_departments(name))")
        .eq("reconciliation_id", selectedReconciliation.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedReconciliation,
  });

  // Fetch schedules
  const { data: schedules = [] } = useQuery({
    queryKey: ["reconciliation-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliation_schedules")
        .select("*")
        .eq("is_active", true)
        .order("next_due_date");
      if (error) throw error;
      return data;
    },
  });

  // Handle QR scan
  const handleQRScanned = async (assetCode: string) => {
    if (!selectedReconciliation) return;
    const item = reconciliationItems.find(
      (i: any) => i.fixed_assets?.asset_code === assetCode
    );
    if (!item) {
      toast.error(`Asset code "${assetCode}" not found in this reconciliation`);
      return;
    }
    if (item.physical_status === "found") return;
    setScanSessionCodes((prev) => [...prev, assetCode]);
    updateItemMutation.mutate({ itemId: item.id, physical_status: "found" });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const num = `REC-${format(new Date(), "yyyyMMdd")}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

      // Get assets filtered by category
      let query = supabase
        .from("fixed_assets")
        .select("id, current_value, category, custom_category")
        .or("status.eq.active,status.eq.under_maintenance");
      
      const { data: allAssetsRaw, error: assetsError } = await query;
      if (assetsError) throw assetsError;

      let assets = allAssetsRaw || [];
      const categoryLabel = newCategory !== "all" ? newCategory : null;
      
      if (categoryLabel) {
        assets = assets.filter((a: any) => getAssetDisplayCategory(a) === categoryLabel);
      }

      if (assets.length === 0) {
        throw new Error("No assets found for the selected category");
      }

      const { data: rec, error: recError } = await supabase
        .from("asset_reconciliations")
        .insert({
          reconciliation_number: num,
          title: newTitle,
          remarks: newRemarks,
          conducted_by: user?.id || null,
          total_assets: assets.length,
          asset_category: categoryLabel,
        } as any)
        .select()
        .single();
      if (recError) throw recError;

      const items = assets.map((a: any) => ({
        reconciliation_id: rec.id,
        asset_id: a.id,
        book_value: a.current_value || 0,
      }));
      const { error: itemsError } = await supabase
        .from("asset_reconciliation_items")
        .insert(items);
      if (itemsError) throw itemsError;

      // Update schedule last_reconciliation_date if category matches
      if (categoryLabel) {
        const matchingSchedule = schedules.find((s: any) => s.asset_category === categoryLabel);
        if (matchingSchedule) {
          const nextDate = calculateNextDate(matchingSchedule.frequency);
          await supabase
            .from("reconciliation_schedules")
            .update({
              last_reconciliation_date: format(new Date(), "yyyy-MM-dd"),
              next_due_date: nextDate,
            } as any)
            .eq("id", matchingSchedule.id);
        }
      }

      return rec;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-reconciliations"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation-schedules"] });
      toast.success(`Reconciliation created${newCategory !== "all" ? ` for ${newCategory}` : " for all assets"}`);
      setShowCreateDialog(false);
      setNewTitle("");
      setNewRemarks("");
      setNewCategory("all");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({
      itemId, physical_status, physical_location, physical_condition, remarks,
    }: {
      itemId: string; physical_status: string; physical_location?: string; physical_condition?: string; remarks?: string;
    }) => {
      const { error } = await supabase
        .from("asset_reconciliation_items")
        .update({
          physical_status,
          physical_location: physical_location || null,
          physical_condition: physical_condition || null,
          remarks: remarks || null,
          verified_at: physical_status !== "not_verified" ? new Date().toISOString() : null,
        })
        .eq("id", itemId);
      if (error) throw error;

      const { data: items } = await supabase
        .from("asset_reconciliation_items")
        .select("physical_status")
        .eq("reconciliation_id", selectedReconciliation.id);

      const verified = items?.filter((i) => i.physical_status !== "not_verified").length || 0;
      const discrepancies = items?.filter((i) =>
        ["missing", "damaged", "location_mismatch"].includes(i.physical_status)
      ).length || 0;

      await supabase
        .from("asset_reconciliations")
        .update({ verified_count: verified, discrepancy_count: discrepancies })
        .eq("id", selectedReconciliation.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-reconciliation-items"] });
      queryClient.invalidateQueries({ queryKey: ["asset-reconciliations"] });
      toast.success("Asset verification updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("asset_reconciliations")
        .update({ status: "completed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-reconciliations"] });
      toast.success("Reconciliation marked as completed");
      setShowDetailDialog(false);
      setSelectedReconciliation(null);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("asset_reconciliations")
        .update({
          status: "approved",
          approved_by: user?.id || null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-reconciliations"] });
      toast.success("Reconciliation approved");
      setShowDetailDialog(false);
      setSelectedReconciliation(null);
    },
  });

  // Schedule mutations
  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("reconciliation_schedules")
        .insert({
          asset_category: scheduleCategory,
          frequency: scheduleFrequency,
          next_due_date: scheduleNextDate,
          remarks: scheduleRemarks || null,
          created_by: user?.id || null,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-schedules"] });
      toast.success("Schedule created");
      setShowScheduleDialog(false);
      setScheduleCategory("");
      setScheduleFrequency("monthly");
      setScheduleRemarks("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reconciliation_schedules")
        .update({ is_active: false } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-schedules"] });
      toast.success("Schedule removed");
    },
  });

  const filtered = reconciliations.filter(
    (r: any) =>
      r.reconciliation_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r as any).asset_category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openDetail = (rec: any) => {
    setSelectedReconciliation(rec);
    setShowDetailDialog(true);
  };

  const totalRecs = reconciliations.length;
  const inProgressCount = reconciliations.filter((r: any) => r.status === "in_progress" || r.status === "draft").length;
  const completedCount = reconciliations.filter((r: any) => r.status === "completed" || r.status === "approved").length;
  const overdueSchedules = schedules.filter((s: any) => isPast(new Date(s.next_due_date)) && !isToday(new Date(s.next_due_date))).length;

  const handlePrint = () => {
    if (!selectedReconciliation) return;
    const printContent = document.getElementById("reconciliation-print-area");
    if (!printContent) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Asset Reconciliation - ${selectedReconciliation.reconciliation_number}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        h2 { margin-bottom: 4px; }
        .header-info { display: flex; justify-content: space-between; margin-bottom: 16px; }
        .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
      </style></head><body>${printContent.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
  };

  // Start reconciliation from a schedule
  const startFromSchedule = (schedule: any) => {
    setNewCategory(schedule.asset_category);
    setNewTitle(`${schedule.asset_category} - ${format(new Date(), "MMM yyyy")}`);
    setNewRemarks(`Scheduled ${schedule.frequency} reconciliation`);
    setShowCreateDialog(true);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <PageHeader
            title="Asset Reconciliation"
            description="Physical verification and reconciliation of fixed assets"
            icon={ClipboardCheck}
            iconColor="bg-slate-500 text-white"
            action={{ label: "New Reconciliation", onClick: () => setShowCreateDialog(true), icon: Plus }}
          />
          <div className="flex gap-2">
            {roles.some((r) => r.role === 'super_admin') && (
              <Button variant="outline" onClick={() => setShowQRLabels(true)}>
                <QrCode className="h-4 w-4 mr-2" /> Print QR Labels
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard title="Total Reconciliations" value={totalRecs} icon={ClipboardCheck} />
          <MetricCard title="In Progress" value={inProgressCount} icon={AlertTriangle} />
          <MetricCard title="Completed" value={completedCount} icon={CheckCircle} />
          <MetricCard title="Overdue Schedules" value={overdueSchedules} icon={Clock} />
        </div>

        <Tabs defaultValue="reconciliations" className="space-y-4">
          <TabsList>
            <TabsTrigger value="reconciliations">Reconciliations</TabsTrigger>
            <TabsTrigger value="schedules">
              Schedules
              {overdueSchedules > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-[10px]">{overdueSchedules}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reconciliations">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Reconciliation Records</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rec #</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Total Assets</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Discrepancies</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No reconciliation records found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">{r.reconciliation_number}</TableCell>
                          <TableCell className="font-medium">{r.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {(r as any).asset_category || "All Categories"}
                            </Badge>
                          </TableCell>
                          <TableCell>{format(new Date(r.reconciliation_date), "dd MMM yyyy")}</TableCell>
                          <TableCell>{r.total_assets}</TableCell>
                          <TableCell>
                            <span className="font-medium" style={{ color: "hsl(var(--primary))" }}>{r.verified_count || 0}</span>
                            <span className="text-muted-foreground">/{r.total_assets}</span>
                          </TableCell>
                          <TableCell>
                            {(r.discrepancy_count || 0) > 0 ? (
                              <span className="font-medium text-destructive">{r.discrepancy_count}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColors[r.status] || ""}>{r.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => openDetail(r)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedules">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" /> Reconciliation Schedules
                  </CardTitle>
                  <Button size="sm" onClick={() => setShowScheduleDialog(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Schedule
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset Category</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Last Reconciliation</TableHead>
                      <TableHead>Next Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No schedules configured. Add a schedule to track reconciliation frequency per category.
                        </TableCell>
                      </TableRow>
                    ) : (
                      schedules.map((s: any) => {
                        const isOverdue = isPast(new Date(s.next_due_date)) && !isToday(new Date(s.next_due_date));
                        const isDueToday = isToday(new Date(s.next_due_date));
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.asset_category}</TableCell>
                            <TableCell className="capitalize">{s.frequency}</TableCell>
                            <TableCell>
                              {s.last_reconciliation_date
                                ? format(new Date(s.last_reconciliation_date), "dd MMM yyyy")
                                : <span className="text-muted-foreground">Never</span>}
                            </TableCell>
                            <TableCell>
                              <span className={isOverdue ? "text-destructive font-semibold" : isDueToday ? "text-amber-600 font-semibold" : ""}>
                                {format(new Date(s.next_due_date), "dd MMM yyyy")}
                              </span>
                            </TableCell>
                            <TableCell>
                              {isOverdue ? (
                                <Badge variant="destructive">Overdue</Badge>
                              ) : isDueToday ? (
                                <Badge className="bg-amber-100 text-amber-800">Due Today</Badge>
                              ) : (
                                <Badge variant="outline">Scheduled</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{s.remarks || "-"}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startFromSchedule(s)}
                                >
                                  Start
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteScheduleMutation.mutate(s.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Asset Reconciliation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Asset Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories ({allAssets.length} assets)</SelectItem>
                  {assetCategories.map((cat) => {
                    const count = allAssets.filter((a: any) => getAssetDisplayCategory(a) === cat).length;
                    return (
                      <SelectItem key={cat} value={cat}>{cat} ({count} assets)</SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Q1 2026 Physical Verification"
              />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={newRemarks}
                onChange={(e) => setNewRemarks(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {newCategory === "all"
                ? `All ${allAssets.length} active assets will be added for verification.`
                : `${allAssets.filter((a: any) => getAssetDisplayCategory(a) === newCategory).length} assets from "${newCategory}" will be added.`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newTitle || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Reconciliation Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Asset Category</Label>
              <Select value={scheduleCategory} onValueChange={setScheduleCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {assetCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequency</Label>
              <Select value={scheduleFrequency} onValueChange={setScheduleFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="half_yearly">Half Yearly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Next Due Date</Label>
              <Input
                type="date"
                value={scheduleNextDate}
                onChange={(e) => setScheduleNextDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={scheduleRemarks}
                onChange={(e) => setScheduleRemarks(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createScheduleMutation.mutate()}
              disabled={!scheduleCategory || createScheduleMutation.isPending}
            >
              {createScheduleMutation.isPending ? "Saving..." : "Save Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={(v) => { setShowDetailDialog(v); if (!v) setSelectedReconciliation(null); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {selectedReconciliation?.reconciliation_number} — {selectedReconciliation?.title}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {(selectedReconciliation?.status === "draft" || selectedReconciliation?.status === "in_progress") && (
                  <Button variant="outline" size="sm" onClick={() => { setScanSessionCodes([]); setShowQRScanner(true); }}>
                    <ScanLine className="h-4 w-4 mr-1" /> Scan QR
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                {selectedReconciliation?.status === "draft" || selectedReconciliation?.status === "in_progress" ? (
                  <Button size="sm" onClick={() => completeMutation.mutate(selectedReconciliation.id)}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Mark Completed
                  </Button>
                ) : null}
                {selectedReconciliation?.status === "completed" && (
                  <Button size="sm" variant="default" onClick={() => approveMutation.mutate(selectedReconciliation.id)}>
                    Approve
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div id="reconciliation-print-area">
            <div className="flex gap-4 text-sm text-muted-foreground mb-4 flex-wrap">
              <span>Date: {selectedReconciliation && format(new Date(selectedReconciliation.reconciliation_date), "dd MMM yyyy")}</span>
              <span>Category: <Badge variant="outline">{(selectedReconciliation as any)?.asset_category || "All"}</Badge></span>
              <span>Status: <Badge className={statusColors[selectedReconciliation?.status] || ""}>{selectedReconciliation?.status}</Badge></span>
              <span>Verified: {selectedReconciliation?.verified_count || 0}/{selectedReconciliation?.total_assets}</span>
              <span>Discrepancies: {selectedReconciliation?.discrepancy_count || 0}</span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Book Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Physical Location</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliationItems.map((item: any) => (
                  <ReconciliationItemRow
                    key={item.id}
                    item={item}
                    editable={selectedReconciliation?.status === "draft" || selectedReconciliation?.status === "in_progress"}
                    onSave={(updates) => updateItemMutation.mutate({ itemId: item.id, ...updates })}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AssetQRLabels open={showQRLabels} onOpenChange={setShowQRLabels} assets={allAssets} />
      <QRScannerDialog open={showQRScanner} onOpenChange={setShowQRScanner} onAssetScanned={handleQRScanned} scannedCodes={scanSessionCodes} />
    </ERPLayout>
  );
}

function calculateNextDate(frequency: string): string {
  const now = new Date();
  switch (frequency) {
    case "weekly": return format(addWeeks(now, 1), "yyyy-MM-dd");
    case "monthly": return format(addMonths(now, 1), "yyyy-MM-dd");
    case "quarterly": return format(addMonths(now, 3), "yyyy-MM-dd");
    case "half_yearly": return format(addMonths(now, 6), "yyyy-MM-dd");
    case "yearly": return format(addMonths(now, 12), "yyyy-MM-dd");
    default: return format(addMonths(now, 1), "yyyy-MM-dd");
  }
}

function ReconciliationItemRow({
  item, editable, onSave,
}: {
  item: any;
  editable: boolean;
  onSave: (updates: { physical_status: string; physical_location?: string; physical_condition?: string; remarks?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(item.physical_status);
  const [location, setLocation] = useState(item.physical_location || "");
  const [condition, setCondition] = useState(item.physical_condition || "");
  const [remarks, setRemarks] = useState(item.remarks || "");

  const asset = item.fixed_assets;

  if (editing && editable) {
    return (
      <TableRow className="bg-muted/30">
        <TableCell className="font-mono text-sm">{asset?.asset_code}</TableCell>
        <TableCell>{asset?.name}</TableCell>
        <TableCell>{asset?.production_departments?.name || "-"}</TableCell>
        <TableCell>Rs. {Number(item.book_value || 0).toLocaleString()}</TableCell>
        <TableCell>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_verified">Not Verified</SelectItem>
              <SelectItem value="found">Found</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
              <SelectItem value="damaged">Damaged</SelectItem>
              <SelectItem value="location_mismatch">Location Mismatch</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Physical location" className="w-32" />
        </TableCell>
        <TableCell>
          <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Condition" className="w-28" />
        </TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks" className="w-28" />
            <Button
              size="sm"
              onClick={() => {
                onSave({ physical_status: status, physical_location: location, physical_condition: condition, remarks });
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>✕</Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow
      className={editable ? "cursor-pointer hover:bg-muted/50" : ""}
      onClick={() => editable && setEditing(true)}
    >
      <TableCell className="font-mono text-sm">{asset?.asset_code}</TableCell>
      <TableCell>{asset?.name}</TableCell>
      <TableCell>{asset?.production_departments?.name || "-"}</TableCell>
      <TableCell>Rs. {Number(item.book_value || 0).toLocaleString()}</TableCell>
      <TableCell>
        <Badge className={physicalStatusColors[item.physical_status] || ""}>
          {physicalStatusLabels[item.physical_status] || item.physical_status}
        </Badge>
      </TableCell>
      <TableCell>{item.physical_location || "-"}</TableCell>
      <TableCell>{item.physical_condition || "-"}</TableCell>
      <TableCell>{item.remarks || "-"}</TableCell>
    </TableRow>
  );
}
