import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Package, ImagePlus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { STOCK_CATEGORIES, stockCategoryMeta, type StockCategory, type StockCategoryFilterValue } from "@/lib/stockCategories";
import { StockCategoryFilter } from "@/components/shared/StockCategoryFilter";
import {
  EMPTY_FINISHED_PRODUCT_DETAILS,
  PLANNING_ITEM_TYPES,
  SKU_OWNER_TYPES,
  planningItemLogoUrl,
  planningItemTypeMeta,
  removePlanningItemLogo,
  skuOwnerTypeMeta,
  uploadPlanningItemLogo,
  type FinishedProductDetails,
  type PlanningItemType,
  type PlanningItemTypeFilterValue,
  type SkuOwnerType,
} from "@/lib/planningItemTypes";

const UNIT_OPTIONS = [
  { value: "sheets", label: "Sheets" },
  { value: "dzns", label: "Dzns" },
  { value: "bags", label: "Bags" },
  { value: "ctns", label: "Ctns" },
];

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** A planning item as listed by the master, with its joined lookups. */
type PlanningItemRow = Database["public"]["Tables"]["planning_items"]["Row"] & {
  production_departments: { name: string } | null;
  customers: { code: string; name: string } | null;
  grades: { code: string; name: string } | null;
};

/** Form state. Finished-product text fields are kept as strings ("" = empty) for the inputs. */
interface PlanningItemForm {
  department_id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  threshold_inventory: number;
  unit: string;
  costing_value: number;
  stock_category: StockCategory;
  item_type: PlanningItemType | "";
  sku_owner_type: SkuOwnerType | "";
  customer_id: string;
  sku_code: string;
  felt: string;
  logo_image_path: string;
  grade_id: string;
  packing: string;
  master_packing: string;
}

const EMPTY_FORM: PlanningItemForm = {
  department_id: "",
  code: "",
  name: "",
  description: "",
  is_active: true,
  threshold_inventory: 0,
  unit: "dzns",
  costing_value: 0,
  stock_category: "standard",
  item_type: "",
  sku_owner_type: "",
  customer_id: "",
  sku_code: "",
  felt: "",
  logo_image_path: "",
  grade_id: "",
  packing: "",
  master_packing: "",
};

const text = (v: string) => (v.trim() ? v.trim() : null);

/** The finished-product columns to save: what was entered for a finished product, all cleared otherwise. */
function finishedDetailsFromForm(form: PlanningItemForm): FinishedProductDetails {
  if (form.item_type !== "finished") return EMPTY_FINISHED_PRODUCT_DETAILS;
  const owner = form.sku_owner_type || null;
  return {
    sku_owner_type: owner,
    customer_id: owner === "customer" && form.customer_id ? form.customer_id : null,
    sku_code: text(form.sku_code),
    felt: text(form.felt),
    logo_image_path: form.logo_image_path || null,
    grade_id: form.grade_id || null,
    packing: text(form.packing),
    master_packing: text(form.master_packing),
  };
}

export default function PlanningItemMasterPage() {
  const queryClient = useQueryClient();
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [stockCategory, setStockCategory] = useState<StockCategoryFilterValue>("all");
  const [itemTypeFilter, setItemTypeFilter] = useState<PlanningItemTypeFilterValue>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanningItemRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PlanningItemForm>(EMPTY_FORM);

  // Logo picture bookkeeping: uploads happen as soon as a file is picked, so a
  // cancelled dialog must drop the new upload and a save must drop the replaced one.
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [newLogoPaths, setNewLogoPaths] = useState<string[]>([]);
  const [replacedLogoPaths, setReplacedLogoPaths] = useState<string[]>([]);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ["departments-planning-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-planning-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Master packing suggestions come from the sales Packing Types master.
  const { data: packingTypes = [] } = useQuery({
    queryKey: ["packing-types-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packing_types")
        .select("id, label")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch planning items
  const { data: items, isLoading } = useQuery({
    queryKey: ["planning-items-master", selectedDepartment, stockCategory, itemTypeFilter],
    queryFn: async () => {
      let query = supabase
        .from("planning_items")
        .select("*, production_departments(name), customers(code, name), grades(code, name)")
        .order("code");

      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      if (stockCategory !== "all") {
        query = query.eq("stock_category", stockCategory);
      }
      if (itemTypeFilter === "unclassified") {
        query = query.is("item_type", null);
      } else if (itemTypeFilter !== "all") {
        query = query.eq("item_type", itemTypeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as PlanningItemRow[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: PlanningItemForm) => {
      const payload = {
        department_id: form.department_id,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description || null,
        is_active: form.is_active,
        threshold_inventory: form.threshold_inventory || 0,
        unit: form.unit || "dzns",
        costing_value: form.costing_value || 0,
        stock_category: form.stock_category,
        item_type: form.item_type || null,
        ...finishedDetailsFromForm(form),
      };
      if (editingItem?.id) {
        const { error } = await supabase
          .from("planning_items")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("planning_items").insert(payload);
        if (error) throw error;
      }
      // Pictures no longer referenced: the one replaced or removed in this
      // dialog, a fresh upload dropped again before saving, and the previously
      // saved picture when the item was switched to WIP.
      const kept = payload.logo_image_path;
      const orphaned = new Set(
        [...replacedLogoPaths, ...newLogoPaths, editingItem?.logo_image_path].filter(
          (p): p is string => !!p && p !== kept,
        ),
      );
      await Promise.all([...orphaned].map((p) => removePlanningItemLogo(p)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items-master"] });
      queryClient.invalidateQueries({ queryKey: ["planning-items-active"] });
      toast.success(editingItem ? "Item updated" : "Item created");
      closeDialog(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save item");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const item = items?.find((i) => i.id === id);
      const { error } = await supabase.from("planning_items").delete().eq("id", id);
      if (error) throw error;
      await removePlanningItemLogo(item?.logo_image_path);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items-master"] });
      queryClient.invalidateQueries({ queryKey: ["planning-items-active"] });
      toast.success("Item deleted");
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete item");
    },
  });

  const resetLogoBookkeeping = () => {
    setNewLogoPaths([]);
    setReplacedLogoPaths([]);
  };

  const openAddDialog = () => {
    setEditingItem(null);
    setFormData({
      ...EMPTY_FORM,
      department_id: selectedDepartment !== "all" ? selectedDepartment : "",
    });
    resetLogoBookkeeping();
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: PlanningItemRow) => {
    setEditingItem(item);
    setFormData({
      department_id: item.department_id,
      code: item.code,
      name: item.name,
      description: item.description || "",
      is_active: item.is_active ?? true,
      threshold_inventory: item.threshold_inventory || 0,
      unit: item.unit || "dzns",
      costing_value: item.costing_value || 0,
      stock_category: (item.stock_category as StockCategory) || "standard",
      item_type: (item.item_type as PlanningItemType) || "",
      sku_owner_type: (item.sku_owner_type as SkuOwnerType) || "",
      customer_id: item.customer_id || "",
      sku_code: item.sku_code || "",
      felt: item.felt || "",
      logo_image_path: item.logo_image_path || "",
      grade_id: item.grade_id || "",
      packing: item.packing || "",
      master_packing: item.master_packing || "",
    });
    resetLogoBookkeeping();
    setIsDialogOpen(true);
  };

  /** Close the dialog; when cancelled, drop pictures uploaded in this dialog but never saved. */
  const closeDialog = (cancelled = true) => {
    if (cancelled) {
      newLogoPaths.forEach((p) => void removePlanningItemLogo(p));
    }
    resetLogoBookkeeping();
    setIsDialogOpen(false);
    setEditingItem(null);
  };

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo picture must be smaller than 5 MB");
      return;
    }
    setUploadingLogo(true);
    try {
      const path = await uploadPlanningItemLogo(file);
      if (formData.logo_image_path) setReplacedLogoPaths((r) => [...r, formData.logo_image_path]);
      setNewLogoPaths((n) => [...n, path]);
      setFormData({ ...formData, logo_image_path: path });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload logo picture");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleLogoRemove = () => {
    if (formData.logo_image_path) setReplacedLogoPaths((r) => [...r, formData.logo_image_path]);
    setFormData({ ...formData, logo_image_path: "" });
  };

  const handleSave = () => {
    if (!formData.department_id) {
      toast.error("Please select a department");
      return;
    }
    if (!formData.code.trim()) {
      toast.error("Please enter item code");
      return;
    }
    if (!formData.name.trim()) {
      toast.error("Please enter item name");
      return;
    }
    if (!formData.item_type) {
      toast.error("Please select whether the item is WIP or a Finished Product");
      return;
    }
    if (formData.item_type === "finished") {
      if (!formData.sku_owner_type) {
        toast.error("Please select Company product / SKU or Customer SKU");
        return;
      }
      if (formData.sku_owner_type === "customer" && !formData.customer_id) {
        toast.error("Please select the customer that owns this SKU");
        return;
      }
    }
    if (uploadingLogo) {
      toast.error("Please wait for the logo picture to finish uploading");
      return;
    }
    saveMutation.mutate(formData);
  };

  const isFinished = formData.item_type === "finished";
  const logoPreviewUrl = planningItemLogoUrl(formData.logo_image_path);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Planning Item Master"
          description="Manage department-wise WIP and finished product items for production planning"
          icon={Package}
        >
          <Button onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </PageHeader>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-4">
              <Label>Filter by Department:</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Item Type:</Label>
              <Select value={itemTypeFilter} onValueChange={(v) => setItemTypeFilter(v as PlanningItemTypeFilterValue)}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Item type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Item Types</SelectItem>
                  {PLANNING_ITEM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="unclassified">Unclassified</SelectItem>
                </SelectContent>
              </Select>
              <Label>Stock Category:</Label>
              <StockCategoryFilter value={stockCategory} onChange={setStockCategory} className="w-56" />
            </div>
          </CardContent>
        </Card>

        {/* Items Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Finished Product</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Costing Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Stock Type</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No items found. Add your first planning item.
                    </TableCell>
                  </TableRow>
                ) : (
                  items?.map((item) => {
                    const typeMeta = planningItemTypeMeta(item.item_type);
                    const ownerMeta = skuOwnerTypeMeta(item.sku_owner_type);
                    const logoUrl = planningItemLogoUrl(item.logo_image_path);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.code}</TableCell>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.production_departments?.name || "-"}</TableCell>
                        <TableCell>
                          {typeMeta ? (
                            <Badge variant="outline" className={typeMeta.badgeClass}>
                              {typeMeta.shortLabel}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground border-dashed">
                              Unclassified
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.item_type === "finished" ? (
                            <div className="flex items-center gap-2">
                              {logoUrl ? (
                                <img
                                  src={logoUrl}
                                  alt="Logo"
                                  className="h-8 w-8 rounded border object-contain bg-white"
                                />
                              ) : null}
                              <div className="text-xs leading-tight">
                                <div className="flex items-center gap-1">
                                  {ownerMeta ? (
                                    <Badge variant="outline" className={ownerMeta.badgeClass}>
                                      {ownerMeta.shortLabel}
                                    </Badge>
                                  ) : null}
                                  {item.sku_code ? <span className="font-medium">{item.sku_code}</span> : null}
                                </div>
                                <div className="text-muted-foreground">
                                  {[
                                    item.customers?.name,
                                    item.grades?.name ? `Grade ${item.grades.name}` : null,
                                    item.felt ? `Felt: ${item.felt}` : null,
                                    item.packing,
                                    item.master_packing,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "No details yet"}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {item.description || "-"}
                        </TableCell>
                        <TableCell>{item.costing_value || 0}</TableCell>
                        <TableCell>
                          <Badge variant={item.is_active ? "default" : "secondary"}>
                            {item.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.stock_category && item.stock_category !== "standard" ? (
                            <Badge variant="outline" className={stockCategoryMeta(item.stock_category).badgeClass}>
                              {stockCategoryMeta(item.stock_category).shortLabel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">Standard</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(item.id)}
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

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Item" : "Add Planning Item"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department *</Label>
                  <Select
                    value={formData.department_id}
                    onValueChange={(v) => setFormData({ ...formData, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Item Type *</Label>
                  <Select
                    value={formData.item_type}
                    onValueChange={(v) => setFormData({ ...formData, item_type: v as PlanningItemType })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="WIP or Finished Product" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLANNING_ITEM_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Item Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g., CUT-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Item Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Gloves Cutting"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Threshold Inventory</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.threshold_inventory}
                    onChange={(e) => setFormData({ ...formData, threshold_inventory: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g., 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Costing Value</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.costing_value}
                    onChange={(e) => setFormData({ ...formData, costing_value: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g., 25.50"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select
                    value={formData.unit}
                    onValueChange={(v) => setFormData({ ...formData, unit: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                />
                <Label>Active</Label>
              </div>

              <div className="space-y-2">
                <Label>Stock Category</Label>
                <Select
                  value={formData.stock_category}
                  onValueChange={(v) => setFormData({ ...formData, stock_category: v as StockCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Non-standard categories are valued separately on the Finished Goods Inventory report.
                </p>
              </div>

              {isFinished && (
                <div className="rounded-md border p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Finished Product Details</h3>
                    <p className="text-xs text-muted-foreground">
                      Commercial details of this finished product. Cleared automatically if the item is changed to WIP.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>SKU Owner *</Label>
                      <Select
                        value={formData.sku_owner_type}
                        onValueChange={(v) =>
                          setFormData({
                            ...formData,
                            sku_owner_type: v as SkuOwnerType,
                            customer_id: v === "customer" ? formData.customer_id : "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Company product / SKU or Customer SKU" />
                        </SelectTrigger>
                        <SelectContent>
                          {SKU_OWNER_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{formData.sku_owner_type === "customer" ? "Customer SKU Code" : "Company SKU Code"}</Label>
                      <Input
                        value={formData.sku_code}
                        onChange={(e) => setFormData({ ...formData, sku_code: e.target.value })}
                        placeholder={formData.sku_owner_type === "customer" ? "Customer's SKU / article code" : "e.g., CS-TB-001"}
                      />
                    </div>
                  </div>

                  {formData.sku_owner_type === "customer" && (
                    <div className="space-y-2">
                      <Label>Customer *</Label>
                      <Select
                        value={formData.customer_id}
                        onValueChange={(v) => setFormData({ ...formData, customer_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select customer" />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.code} — {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Felt</Label>
                      <Input
                        value={formData.felt}
                        onChange={(e) => setFormData({ ...formData, felt: e.target.value })}
                        placeholder="e.g., Premium wool felt, yellow"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Grade</Label>
                      <Select
                        value={formData.grade_id || "none"}
                        onValueChange={(v) => setFormData({ ...formData, grade_id: v === "none" ? "" : v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select grade" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {grades.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.code} — {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Packing</Label>
                      <Input
                        value={formData.packing}
                        onChange={(e) => setFormData({ ...formData, packing: e.target.value })}
                        placeholder="e.g., 3 balls per can"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Master Packing</Label>
                      <Input
                        list="planning-item-master-packing-options"
                        value={formData.master_packing}
                        onChange={(e) => setFormData({ ...formData, master_packing: e.target.value })}
                        placeholder="e.g., 6 Dz CTN"
                      />
                      <datalist id="planning-item-master-packing-options">
                        {packingTypes.map((p) => (
                          <option key={p.id} value={p.label} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Logo Picture</Label>
                    <div className="flex items-center gap-4">
                      {logoPreviewUrl ? (
                        <img
                          src={logoPreviewUrl}
                          alt="Logo preview"
                          className="h-20 w-20 rounded border object-contain bg-white"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                          <ImagePlus className="h-6 w-6" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleLogoUpload(file);
                          }}
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingLogo}
                            onClick={() => logoInputRef.current?.click()}
                          >
                            {uploadingLogo ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <ImagePlus className="h-4 w-4 mr-2" />
                            )}
                            {formData.logo_image_path ? "Replace picture" : "Upload picture"}
                          </Button>
                          {formData.logo_image_path && (
                            <Button type="button" variant="ghost" size="sm" onClick={handleLogoRemove}>
                              <X className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">PNG, JPG or SVG up to 5 MB.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => closeDialog()}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saveMutation.isPending || uploadingLogo}>
                  {editingItem ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Item?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the planning item.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
