import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Database, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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
  customer_id: string | null;
  base_product_id: string | null;
  is_active: boolean | null;
  grades?: { name: string } | null;
  units_of_measure?: { name: string } | null;
  planning_items?: { code: string; name: string } | null;
  customer?: { code: string; name: string } | null;
  base_product?: { code: string; name: string } | null;
}

type OwnerFilter = "all" | "own" | "customer";

const EMPTY_FORM = {
  owner_type: "own" as ProductOwnerType,
  customer_id: "",
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
  is_active: true,
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Product | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  const isCustomerSku = formData.owner_type === "customer";
  const isCreate = !selectedItem;

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "*, grades(name), units_of_measure(name), planning_items(code, name), " +
            "customer:customers!products_customer_id_fkey(code, name), " +
            "base_product:products!products_base_product_id_fkey(code, name)",
        )
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

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-active-for-sku"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Preview of the code the database will assign to a new customer SKU.
  const { data: nextCode } = useQuery({
    queryKey: ["next-customer-sku-code", formData.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("next_customer_sku_code", {
        p_customer_id: formData.customer_id,
      });
      if (error) throw error;
      return data as string | null;
    },
    enabled: dialogOpen && isCreate && isCustomerSku && !!formData.customer_id,
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
      if (customer && !data.customer_id) {
        throw new Error("Pick the customer who owns this SKU");
      }
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
        customer_id: customer ? data.customer_id : null,
        base_product_id: customer ? data.base_product_id || null : null,
        is_active: data.is_active,
      };
      if (data.id) {
        const { error } = await supabase
          .from("products")
          .update({ ...payload, code: data.code })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        // Customer SKU codes are generated by the database trigger
        // (<customer code>-NNN) when the code is left blank.
        const { error } = await supabase.from("products").insert({
          ...payload,
          code: customer ? "" : data.code,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
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
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const openCreate = (ownerType: ProductOwnerType) => {
    setSelectedItem(null);
    setFormData({ ...EMPTY_FORM, owner_type: ownerType });
    setDialogOpen(true);
  };

  const handleEdit = (item: Product) => {
    setSelectedItem(item);
    setFormData({
      owner_type: item.owner_type === "customer" ? "customer" : "own",
      customer_id: item.customer_id || "",
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
      is_active: item.is_active ?? true,
    });
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
      customer_id: value === "customer" ? f.customer_id : "",
      base_product_id: value === "customer" ? f.base_product_id : "",
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "owner",
      header: "Owner",
      render: (item: Product) =>
        item.owner_type === "customer" ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="secondary" className="w-fit text-xs">
              {item.customer?.name ?? "Customer"}
            </Badge>
            {item.base_product && (
              <span className="text-xs text-muted-foreground">
                base: {item.base_product.code}
              </span>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="w-fit text-xs">
            Own
          </Badge>
        ),
    },
    {
      key: "grades.name",
      header: "Grade",
      render: (item: Product) => item.grades?.name || "-",
    },
    {
      key: "units_of_measure.name",
      header: "UOM",
      render: (item: Product) => item.units_of_measure?.name || "-",
    },
    { key: "standard_output_rate", header: "Std Output" },
    {
      key: "planning_items.name",
      header: "Planning Item",
      render: (item: Product) =>
        item.planning_items
          ? `${item.planning_items.code} — ${item.planning_items.name}`
          : <span className="text-amber-600 text-xs">⚠ not linked</span>,
    },
    {
      key: "standard_cost",
      header: "Std Cost / Dz",
      render: (item: Product) =>
        item.standard_cost != null
          ? `Rs. ${Number(item.standard_cost).toLocaleString()}`
          : <span className="text-amber-600 text-xs">⚠ unset</span>,
    },
    {
      key: "standard_selling_price",
      header: "Std Sell / Dz",
      render: (item: Product) =>
        item.standard_selling_price != null && Number(item.standard_selling_price) > 0
          ? `Rs. ${Number(item.standard_selling_price).toLocaleString()}`
          : <span className="text-amber-600 text-xs">⚠ unset</span>,
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: Product) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Product) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

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
          action={{
            label: "Add Product",
            onClick: () => openCreate(ownerFilter === "customer" ? "customer" : "own"),
            icon: Plus,
          }}
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
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate("customer")}>
              <Plus className="mr-1 h-4 w-4" />
              Customer SKU
            </Button>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={visibleProducts}
          emptyMessage={isLoading ? "Loading..." : "No products found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
                    <Label>Customer</Label>
                    <SearchableSelect
                      value={formData.customer_id}
                      onValueChange={(v) => setFormData({ ...formData, customer_id: v })}
                      placeholder="Pick customer"
                      options={customers.map((c) => ({
                        value: c.id,
                        label: c.name,
                        secondary: `(${c.code})`,
                        search: c.code,
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
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  {isCustomerSku && isCreate ? (
                    <>
                      <Input
                        id="code"
                        value={nextCode ?? ""}
                        placeholder={formData.customer_id ? "Generating…" : "Pick a customer first"}
                        disabled
                      />
                      <p className="text-xs text-muted-foreground">
                        Auto-generated as customer code + serial.
                      </p>
                    </>
                  ) : (
                    <Input
                      id="code"
                      value={formData.code}
                      onChange={(e) =>
                        setFormData({ ...formData, code: e.target.value })
                      }
                      required
                    />
                  )}
                </div>
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
