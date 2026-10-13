import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProductsTable } from "@/components/materials/ProductsTable";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AutoCodeField } from "@/components/shared/AutoCodeField";
import { Database, Plus, AlertTriangle, Layers, Grid3x3, Settings2, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductOwnerType } from "@/lib/customerSkus";
import type { SlotKey } from "@/lib/productMaterials";
import {
  effectiveMaterials,
  MATERIAL_QUERY_KEYS,
  stockLevel,
  useMaterialData,
} from "@/components/materials/useMaterialData";
import {
  draftFromRows,
  type MaterialDraft,
  ProductMaterialsEditor,
  saveProductMaterials,
  validateDraft,
} from "@/components/materials/ProductMaterialsEditor";
import { BulkAssignDialog, ColumnSetupDialog, QuickEditGrid } from "@/components/materials/MaterialTools";

interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  grade_id: string | null;
  uom_id: string | null;
  standard_output_rate: number | null;
  standard_cost: number | null;
  standard_selling_price: number | null;
  planning_item_id: string | null;
  owner_type: ProductOwnerType;
  customer_party_id: string | null;
  base_product_id: string | null;
  is_active: boolean | null;
  color: string | null;
  grades?: { name: string } | null;
  units_of_measure?: { name: string } | null;
  planning_items?: { code: string; name: string } | null;
}

interface PartyRef {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean | null;
}

type OwnerFilter = "all" | "own" | "customer";

const EMPTY_FORM = {
  owner_type: "own" as ProductOwnerType,
  customer_party_id: "",
  base_product_id: "",
  code: "",
  name: "",
  description: "",
  grade_id: "",
  uom_id: "",
  standard_output_rate: 0,
  standard_cost: 0,
  standard_selling_price: 0,
  planning_item_id: "",
  color: "",
  is_active: true,
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission, user } = useAuth();
  // Master Data tiers: manager/officer create + edit, viewer read-only; delete stays
  // with super admin (or an explicit per-user delete grant on the module).
  const canCreate = hasModulePermission("master_data", "create");
  const canEdit = hasModulePermission("master_data", "edit");
  const canDelete = hasModulePermission("master_data", "delete");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Product | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>({});
  // Materials are only saved once the form was filled from loaded data, so a
  // product's materials are never wiped by saving before they arrived.
  const [materialDraftReady, setMaterialDraftReady] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [columnSetupOpen, setColumnSetupOpen] = useState(false);
  const [quickEdit, setQuickEdit] = useState(false);
  const material = useMaterialData();

  useEffect(() => {
    if (!dialogOpen || materialDraftReady || material.isLoading) return;
    setMaterialDraft(selectedItem ? draftFromRows(material.byProduct.get(selectedItem.id)) : {});
    setMaterialDraftReady(true);
  }, [dialogOpen, materialDraftReady, material.isLoading, material.byProduct, selectedItem]);

  const isCustomerSku = formData.owner_type === "customer";
  const isCreate = !selectedItem;

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, grades(name), units_of_measure(name), planning_items(code, name)")
        .order("code", { ascending: true });
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const { data: planningItems = [] } = useQuery({
    queryKey: ["planning-items-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planning_items")
        .select("id, code, name, production_departments(name)")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: uoms = [] } = useQuery({
    queryKey: ["uoms-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Owners of customer SKUs are accounts-receivable customers: accounting
  // parties of type "customer", not rows of the sales customers master.
  const { data: customers = [] } = useQuery({
    queryKey: ["ar-customer-parties-for-sku"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_parties")
        .select("id, code, name, is_active")
        .eq("party_type", "customer")
        .order("name");
      if (error) throw error;
      return data as PartyRef[];
    },
  });

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.is_active !== false),
    [customers],
  );

  // Owner details are looked up client-side: embedding customers / a
  // self-referencing products join in the master query fails in PostgREST.
  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // Preview of the code the database will assign to a new customer SKU.
  const { data: nextCode } = useQuery({
    queryKey: ["next-customer-sku-code", formData.customer_party_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("next_customer_sku_code", {
        p_party_id: formData.customer_party_id,
      });
      if (error) throw error;
      return data as string | null;
    },
    enabled: dialogOpen && isCreate && isCustomerSku && !!formData.customer_party_id,
  });

  const ownProducts = useMemo(
    () => products.filter((p) => p.owner_type !== "customer"),
    [products],
  );

  const visibleProducts = useMemo(() => {
    if (ownerFilter === "own") return ownProducts;
    if (ownerFilter === "customer")
      return products.filter((p) => p.owner_type === "customer");
    return products;
  }, [products, ownProducts, ownerFilter]);

  const counts = {
    all: products.length,
    own: ownProducts.length,
    customer: products.length - ownProducts.length,
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      const customer = data.owner_type === "customer";
      if (customer && !data.customer_party_id) {
        throw new Error("Pick the accounts-receivable customer who owns this SKU");
      }
      const draftError = canEdit && materialDraftReady ? validateDraft(materialDraft, material.slots) : null;
      if (draftError) throw new Error(draftError);
      const payload = {
        name: data.name,
        description: data.description || null,
        grade_id: data.grade_id || null,
        uom_id: data.uom_id || null,
        standard_output_rate: data.standard_output_rate || null,
        standard_cost: data.standard_cost || null,
        standard_selling_price: data.standard_selling_price || null,
        planning_item_id: data.planning_item_id || null,
        owner_type: data.owner_type,
        customer_party_id: customer ? data.customer_party_id : null,
        base_product_id: customer ? data.base_product_id || null : null,
        is_active: data.is_active,
        // products.color arrives with the material migration; only send it
        // once that migration is live (its slot table then has rows).
        ...(material.slots.length > 0 ? { color: data.color.trim() || null } : {}),
      };
      let productId = data.id;
      if (data.id) {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        // Codes are generated by the database trigger when left blank:
        // customer SKUs get <customer code>-NNN, own products the next serial.
        const { data: created, error } = await supabase
          .from("products")
          .insert({
            ...payload,
            code: "",
          })
          .select("id")
          .single();
        if (error) throw error;
        productId = created.id;
      }
      if (canEdit && productId && materialDraftReady) {
        const copiesBase = customer && !!payload.base_product_id;
        const editable = material.slots
          .filter((s) => !copiesBase || s.customer_override)
          .map((s) => s.key);
        await saveProductMaterials(
          productId,
          materialDraft,
          material.byProduct.get(productId),
          editable,
          user?.id ?? null,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: MATERIAL_QUERY_KEYS.materials });
      queryClient.invalidateQueries({ queryKey: ["product-material-stock"] });
      queryClient.invalidateQueries({ queryKey: ["next-customer-sku-code"] });
      toast.success(selectedItem ? "Product updated" : "Product created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({ ...EMPTY_FORM });
    setMaterialDraft({});
    setMaterialDraftReady(false);
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const openCreate = (ownerType: ProductOwnerType) => {
    setSelectedItem(null);
    setFormData({ ...EMPTY_FORM, owner_type: ownerType });
    setMaterialDraft({});
    setMaterialDraftReady(false);
    setDialogOpen(true);
  };

  const handleEdit = (item: Product) => {
    setSelectedItem(item);
    setFormData({
      owner_type: item.owner_type === "customer" ? "customer" : "own",
      customer_party_id: item.customer_party_id || "",
      base_product_id: item.base_product_id || "",
      code: item.code,
      name: item.name,
      description: item.description || "",
      grade_id: item.grade_id || "",
      uom_id: item.uom_id || "",
      standard_output_rate: item.standard_output_rate || 0,
      standard_cost: item.standard_cost || 0,
      standard_selling_price: item.standard_selling_price || 0,
      planning_item_id: item.planning_item_id || "",
      color: item.color || "",
      is_active: item.is_active ?? true,
    });
    setMaterialDraft({});
    setMaterialDraftReady(false);
    setDialogOpen(true);
  };

  const handleDelete = (item: Product) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  // Picking a base product pre-fills every blank spec field from it so the
  // customer SKU shares the planning item / cost of the product we make.
  // Anything already typed is left alone.
  const handleBaseProductChange = (baseId: string) => {
    const base = ownProducts.find((p) => p.id === baseId);
    setFormData((f) => ({
      ...f,
      base_product_id: baseId,
      grade_id: f.grade_id || base?.grade_id || "",
      uom_id: f.uom_id || base?.uom_id || "",
      standard_output_rate: f.standard_output_rate || base?.standard_output_rate || 0,
      planning_item_id: f.planning_item_id || base?.planning_item_id || "",
      standard_cost: f.standard_cost || base?.standard_cost || 0,
      standard_selling_price:
        f.standard_selling_price || base?.standard_selling_price || 0,
    }));
  };

  const handleOwnerTypeChange = (value: ProductOwnerType) => {
    setFormData((f) => ({
      ...f,
      owner_type: value,
      customer_party_id: value === "customer" ? f.customer_party_id : "",
      base_product_id: value === "customer" ? f.base_product_id : "",
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  // Products using a material that is out / below min / never counted.
  const stockProblemCount = useMemo(() => {
    let n = 0;
    for (const p of products) {
      if (p.is_active === false) continue;
      const rows = effectiveMaterials(p, material.byProduct);
      for (const r of rows.values()) {
        if (stockLevel(material.stock.get(r.item_id)) !== "ok") { n++; break; }
      }
    }
    return n;
  }, [products, material.byProduct, material.stock]);

  const copyMaterialsFrom = (sourceId: string) => {
    const src = productById.get(sourceId);
    if (!src) return;
    const rows = effectiveMaterials(src, material.byProduct);
    const copiesBase = isCustomerSku && !!formData.base_product_id;
    const next: MaterialDraft = { ...materialDraft };
    for (const s of material.slots) {
      if (copiesBase && !s.customer_override) continue;
      const r = rows.get(s.key as SlotKey);
      next[s.key] = r
        ? { item_id: r.item_id, qty: String(Number(r.qty_per_dozen)), wastage: String(Number(r.wastage_pct)) }
        : { item_id: "", qty: "", wastage: "0" };
    }
    setMaterialDraft(next);
    toast.success(`Materials copied from ${src.code} — review and Save`);
  };

  const filterTabs: { key: OwnerFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "own", label: "Own SKUs" },
    { key: "customer", label: "Customer SKUs" },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Products / SKUs"
          description="Manage our own SKUs and customers' private-label SKUs"
          icon={Database}
          iconColor="bg-purple-500/10 text-purple-500"
          action={canCreate ? {
            label: "Add Product",
            onClick: () => openCreate(ownerFilter === "customer" ? "customer" : "own"),
            icon: Plus,
          } : undefined}
        />

        <div className="flex flex-wrap items-center gap-2">
          {filterTabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              size="sm"
              variant={ownerFilter === tab.key ? "default" : "outline"}
              onClick={() => setOwnerFilter(tab.key)}
            >
              {tab.label}
              <span className="ml-2 rounded-full bg-background/20 px-1.5 text-xs">
                {counts[tab.key]}
              </span>
            </Button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button asChild type="button" size="sm" variant="outline">
              <Link to="/master/setup-check">
                <ClipboardCheck className="mr-1 h-4 w-4" />
                Setup Check
              </Link>
            </Button>
            {canEdit && material.slots.length > 0 && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                  <Layers className="mr-1 h-4 w-4" />
                  Bulk Assign
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={quickEdit ? "default" : "outline"}
                  onClick={() => setQuickEdit((q) => !q)}
                >
                  <Grid3x3 className="mr-1 h-4 w-4" />
                  {quickEdit ? "Exit Quick Edit" : "Quick Edit"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setColumnSetupOpen(true)}>
                  <Settings2 className="mr-1 h-4 w-4" />
                  Column setup
                </Button>
              </>
            )}
            {canCreate && (
              <Button type="button" size="sm" variant="outline" onClick={() => openCreate("customer")}>
                <Plus className="mr-1 h-4 w-4" />
                Customer SKU
              </Button>
            )}
          </div>
        </div>

        {stockProblemCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
            <span className="flex-1">
              <strong>{stockProblemCount} product{stockProblemCount === 1 ? "" : "s"}</strong> use a material that is out of
              stock, below min stock or never counted. Confirming an order for them raises a red alert.
            </span>
            <Link to="/purchase/material-shortages" className="font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-300">
              View shortages
            </Link>
          </div>
        )}

        {quickEdit && canEdit ? (
          <QuickEditGrid
            products={visibleProducts.map((p) => ({ ...p, grade_name: p.grades?.name ?? null }))}
            slots={material.slots}
            items={material.items}
            byProduct={material.byProduct}
            userId={user?.id ?? null}
          />
        ) : (
          <ProductsTable
            products={visibleProducts}
            slots={material.slots}
            byProduct={material.byProduct}
            itemById={material.itemById}
            stock={material.stock}
            customerName={(id) => customerById.get(id)?.name}
            productCode={(id) => productById.get(id)?.code}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={(p) => handleEdit(p as Product)}
            onDelete={(p) => handleDelete(p as Product)}
            emptyMessage={isLoading ? "Loading..." : "No products found"}
          />
        )}

        <BulkAssignDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          slots={material.slots}
          items={material.items}
          products={products}
          byProduct={material.byProduct}
          grades={grades}
          userId={user?.id ?? null}
        />
        <ColumnSetupDialog
          open={columnSetupOpen}
          onOpenChange={setColumnSetupOpen}
          slots={material.slots}
          categories={material.categories}
          subcategories={material.subcategories}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedItem
                  ? isCustomerSku ? "Edit Customer SKU" : "Edit Product"
                  : isCustomerSku ? "Add Customer SKU" : "Add Product"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="owner_type">SKU Owner</Label>
                  <Select
                    value={formData.owner_type}
                    onValueChange={(v) => handleOwnerTypeChange(v as ProductOwnerType)}
                  >
                    <SelectTrigger id="owner_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="own">Own (company SKU)</SelectItem>
                      <SelectItem value="customer">Customer (private label)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isCustomerSku
                      ? "Customer's own brand & packaging. Sold only to that customer."
                      : "Our brand. Can be sold to any customer."}
                  </p>
                </div>
                {isCustomerSku && (
                  <div className="space-y-2">
                    <Label>Customer (accounts receivable)</Label>
                    <SearchableSelect
                      value={formData.customer_party_id}
                      onValueChange={(v) => setFormData({ ...formData, customer_party_id: v })}
                      placeholder="Pick receivables customer"
                      options={activeCustomers.map((c) => ({
                        value: c.id,
                        label: c.name,
                        secondary: c.code ? `(${c.code})` : "",
                        search: c.code || c.name,
                      }))}
                    />
                  </div>
                )}
              </div>

              {isCustomerSku && (
                <div className="space-y-2">
                  <Label>Base Product (our SKU it is made from)</Label>
                  <SearchableSelect
                    value={formData.base_product_id}
                    onValueChange={handleBaseProductChange}
                    placeholder="Optional — pick our equivalent SKU"
                    options={ownProducts
                      .filter((p) => p.is_active)
                      .map((p) => ({
                        value: p.id,
                        label: p.name,
                        secondary: `(${p.code})`,
                        search: p.code,
                      }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Grade, UOM, output, planning item and costs left blank below are filled from the base product.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {isCustomerSku && isCreate ? (
                  <div className="space-y-2">
                    <Label htmlFor="code">Code</Label>
                    <Input
                      id="code"
                      value={nextCode ?? ""}
                      placeholder={formData.customer_party_id ? "Generating…" : "Pick a receivables customer first"}
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Auto-generated as the party's code (or first 8 letters of its name) + serial.
                    </p>
                  </div>
                ) : (
                  <AutoCodeField
                    entity="products"
                    id="code"
                    value={selectedItem?.code}
                    isEdit={!isCreate}
                    label="Code"
                  />
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="grade_id">Grade</Label>
                  <Select
                    value={formData.grade_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, grade_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((grade) => (
                        <SelectItem key={grade.id} value={grade.id}>
                          {grade.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom_id">Unit of Measure</Label>
                  <Select
                    value={formData.uom_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, uom_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {uoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>
                          {uom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="standard_output_rate">Standard Output Rate</Label>
                  <Input
                    id="standard_output_rate"
                    type="number"
                    value={formData.standard_output_rate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_output_rate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="standard_cost">Standard Cost (Rs. per dozen)</Label>
                  <Input
                    id="standard_cost"
                    type="number"
                    step="0.01"
                    value={formData.standard_cost}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_cost: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Used for per-dispatch COGS posting in accounting.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="standard_selling_price">Standard Selling Price (Rs. per dozen)</Label>
                  <Input
                    id="standard_selling_price"
                    type="number"
                    step="0.01"
                    value={formData.standard_selling_price}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_selling_price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Default sale price auto-filled on sales orders &amp; quotations when no customer-specific price exists.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planning_item_id">Linked Planning Item</Label>
                <Select
                  value={formData.planning_item_id || "none"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      planning_item_id: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select planning item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {planningItems.map((pi: any) => (
                      <SelectItem key={pi.id} value={pi.id}>
                        {pi.code} — {pi.name}
                        {pi.production_departments?.name
                          ? ` (${pi.production_departments.name})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Stock item this product is dispatched from. Used by the Monthly Production report — unlinked products are flagged there.
                </p>
              </div>
              {material.slots.length > 0 && (<>
              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <Input
                  id="color"
                  value={formData.color}
                  placeholder="e.g. Yellow"
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Label only — no stock check.</p>
              </div>
              <ProductMaterialsEditor
                product={{ id: selectedItem?.id, owner_type: formData.owner_type, base_product_id: formData.base_product_id || null }}
                slots={material.slots}
                items={material.items}
                itemById={material.itemById}
                stock={material.stock}
                draft={materialDraft}
                onChange={setMaterialDraft}
                inherited={
                  isCustomerSku && formData.base_product_id
                    ? material.byProduct.get(formData.base_product_id)
                    : undefined
                }
                copyOptions={products
                  .filter((p) => p.id !== selectedItem?.id)
                  .map((p) => ({ value: p.id, label: p.name, secondary: `(${p.code})`, search: p.code }))}
                onCopyFrom={copyMaterialsFrom}
                readOnly={!canEdit}
              />
              </>)}
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Product</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedItem?.name}"? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedItem && deleteMutation.mutate(selectedItem.id)}
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
