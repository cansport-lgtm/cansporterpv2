import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Plus as PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Eye, Search } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type AssetCategory = "office_assets" | "production_machinery" | "molds_dies" | "machine_spare_parts";
type AssetStatus = "active" | "under_maintenance" | "disposed" | "written_off" | "sold";

interface FixedAsset {
  id: string;
  asset_code: string;
  name: string;
  description: string | null;
  category: AssetCategory;
  custom_category: string | null;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  status: AssetStatus;
  department_id: string | null;
  location_description: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  warranty_expiry: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  responsible_person: string | null;
  disposal_date: string | null;
  disposal_reason: string | null;
  disposal_value: number | null;
  production_departments?: { name: string } | null;
}

const CATEGORY_OPTIONS: { value: AssetCategory | "other"; label: string }[] = [
  { value: "office_assets", label: "Office Assets" },
  { value: "production_machinery", label: "Production Machinery" },
  { value: "molds_dies", label: "Molds & Dies" },
  { value: "machine_spare_parts", label: "Machine Spare Parts" },
  { value: "other", label: "Other (Custom)" },
];

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "under_maintenance", label: "Under Maintenance" },
  { value: "disposed", label: "Disposed" },
  { value: "written_off", label: "Written Off" },
  { value: "sold", label: "Sold" },
];

const getStatusVariant = (status: AssetStatus) => {
  switch (status) {
    case "active":
      return "default";
    case "under_maintenance":
      return "secondary";
    case "disposed":
    case "written_off":
      return "destructive";
    case "sold":
      return "outline";
    default:
      return "default";
  }
};

const defaultFormData = {
  asset_code: "",
  name: "",
  description: "",
  category: "office_assets" as AssetCategory | "other",
  custom_category: "",
  purchase_date: "",
  purchase_price: 0,
  current_value: 0,
  status: "active" as AssetStatus,
  department_id: "",
  location_description: "",
  serial_number: "",
  manufacturer: "",
  model: "",
  warranty_expiry: "",
  supplier_name: "",
  invoice_number: "",
  responsible_person: "",
};

export default function FixedAssetsListPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);
  const [formData, setFormData] = useState(defaultFormData);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [responsiblePersonFilter, setResponsiblePersonFilter] = useState<string>("all");

  // Fetch assets
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*, production_departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as FixedAsset[];
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch dynamic categories
  const { data: dynamicCategories = [] } = useQuery({
    queryKey: ["fixed_asset_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_asset_categories")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const enumMap: Record<string, AssetCategory> = {
        "Office Assets": "office_assets",
        "Production Machinery": "production_machinery",
        "Molds & Dies": "molds_dies",
        "Machine Spare Parts": "machine_spare_parts",
      };
      const resolvedCategory = (data.custom_category && enumMap[data.custom_category]) || "office_assets";
      const insertData = {
        asset_code: data.asset_code,
        name: data.name,
        description: data.description || null,
        category: resolvedCategory as AssetCategory,
        custom_category: data.custom_category || null,
        purchase_date: data.purchase_date || null,
        purchase_price: data.purchase_price,
        current_value: data.current_value,
        status: data.status,
        department_id: data.department_id || null,
        location_description: data.location_description || null,
        serial_number: data.serial_number || null,
        manufacturer: data.manufacturer || null,
        model: data.model || null,
        warranty_expiry: data.warranty_expiry || null,
        supplier_name: data.supplier_name || null,
        invoice_number: data.invoice_number || null,
        responsible_person: data.responsible_person || null,
      };
      const { error } = await supabase.from("fixed_assets").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      toast.success("Asset created successfully");
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { id, ...rest } = data;
      const enumMap: Record<string, AssetCategory> = {
        "Office Assets": "office_assets",
        "Production Machinery": "production_machinery",
        "Molds & Dies": "molds_dies",
        "Machine Spare Parts": "machine_spare_parts",
      };
      const resolvedCategory = (rest.custom_category && enumMap[rest.custom_category]) || "office_assets";
      const updateData = {
        asset_code: rest.asset_code,
        name: rest.name,
        description: rest.description || null,
        category: resolvedCategory as AssetCategory,
        custom_category: rest.custom_category || null,
        purchase_date: rest.purchase_date || null,
        purchase_price: rest.purchase_price,
        current_value: rest.current_value,
        status: rest.status,
        department_id: rest.department_id || null,
        location_description: rest.location_description || null,
        serial_number: rest.serial_number || null,
        manufacturer: rest.manufacturer || null,
        model: rest.model || null,
        warranty_expiry: rest.warranty_expiry || null,
        supplier_name: rest.supplier_name || null,
        invoice_number: rest.invoice_number || null,
        responsible_person: rest.responsible_person || null,
      };
      const { error } = await supabase
        .from("fixed_assets")
        .update(updateData)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      toast.success("Asset updated successfully");
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fixed_assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      toast.success("Asset deleted successfully");
      setIsDeleteDialogOpen(false);
      setSelectedAsset(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleOpenCreate = () => {
    setSelectedAsset(null);
    setFormData(defaultFormData);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (asset: FixedAsset) => {
    setSelectedAsset(asset);
    // Use custom_category if available, otherwise map enum to name
    const enumToName: Record<string, string> = {
      "office_assets": "Office Assets",
      "production_machinery": "Production Machinery",
      "molds_dies": "Molds & Dies",
      "machine_spare_parts": "Machine Spare Parts",
    };
    const categoryName = asset.custom_category || enumToName[asset.category] || asset.category;
    setFormData({
      asset_code: asset.asset_code,
      name: asset.name,
      description: asset.description || "",
      category: asset.category,
      custom_category: categoryName,
      purchase_date: asset.purchase_date || "",
      purchase_price: asset.purchase_price,
      current_value: asset.current_value,
      status: asset.status,
      department_id: asset.department_id || "",
      location_description: asset.location_description || "",
      serial_number: asset.serial_number || "",
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      warranty_expiry: asset.warranty_expiry || "",
      supplier_name: asset.supplier_name || "",
      invoice_number: asset.invoice_number || "",
      responsible_person: asset.responsible_person || "",
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedAsset(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = () => {
    if (!formData.asset_code.trim() || !formData.name.trim()) {
      toast.error("Asset code and name are required");
      return;
    }
    
    if (!formData.custom_category) {
      toast.error("Please select a category");
      return;
    }

    if (selectedAsset) {
      updateMutation.mutate({ ...formData, id: selectedAsset.id });
    } else {
      createMutation.mutate(formData);
    }
  };

  // Helper to display category name
  const getCategoryDisplay = (asset: FixedAsset) => {
    if (asset.custom_category) {
      return asset.custom_category;
    }
    const dynamic = dynamicCategories.find((c: any) => c.name.toLowerCase().replace(/[^a-z]/g, '_').includes(asset.category.replace(/_/g, '')));
    if (dynamic) return dynamic.name;
    return CATEGORY_OPTIONS.find((c) => c.value === asset.category)?.label || asset.category;
  };

  // Get unique responsible persons for filter
  const responsiblePersons = [...new Set(assets.map(a => a.responsible_person).filter(Boolean))] as string[];

  // Filter assets
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.asset_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (asset.serial_number?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    const matchesCategory = categoryFilter === "all" || getCategoryDisplay(asset) === categoryFilter;
    const matchesStatus = statusFilter === "all" || asset.status === statusFilter;
    const matchesResponsible = responsiblePersonFilter === "all" || asset.responsible_person === responsiblePersonFilter;
    return matchesSearch && matchesCategory && matchesStatus && matchesResponsible;
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Fixed Assets"
          description="Manage all company fixed assets"
          action={{
            label: "Add Asset",
            onClick: handleOpenCreate,
            icon: PlusIcon,
          }}
        />

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code, name, or serial number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {dynamicCategories.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={responsiblePersonFilter} onValueChange={setResponsiblePersonFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Responsible Person" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Persons</SelectItem>
                  {responsiblePersons.map((person) => (
                    <SelectItem key={person} value={person}>
                      {person}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Responsible Person</TableHead>
                    <TableHead className="text-right">Purchase Price</TableHead>
                    <TableHead className="text-right">Current Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                     <TableCell colSpan={9} className="text-center py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : filteredAssets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No assets found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAssets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-mono font-medium">{asset.asset_code}</TableCell>
                        <TableCell className="font-medium">{asset.name}</TableCell>
                        <TableCell>
                          {getCategoryDisplay(asset)}
                        </TableCell>
                        <TableCell>{asset.production_departments?.name || "-"}</TableCell>
                        <TableCell>{asset.responsible_person || "-"}</TableCell>
                        <TableCell className="text-right">
                          ₹{Number(asset.purchase_price).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{Number(asset.current_value).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(asset.status)}>
                            {STATUS_OPTIONS.find((s) => s.value === asset.status)?.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedAsset(asset);
                                setIsViewDialogOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(asset)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedAsset(asset);
                                setIsDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedAsset ? "Edit Asset" : "Add New Asset"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>Asset Code *</Label>
                <Input
                  value={formData.asset_code}
                  onChange={(e) => setFormData({ ...formData, asset_code: e.target.value })}
                  placeholder="e.g., FA-001"
                />
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Asset name"
                />
              </div>
              <div className="space-y-2">
                <Label>Category *</Label>
               <Select
                  value={formData.custom_category || ""}
                  onValueChange={(v) => {
                    // Find if the selected category name maps to a known enum value
                    const enumMap: Record<string, AssetCategory> = {
                      "Office Assets": "office_assets",
                      "Production Machinery": "production_machinery",
                      "Molds & Dies": "molds_dies",
                      "Machine Spare Parts": "machine_spare_parts",
                    };
                    const enumVal = enumMap[v];
                    if (enumVal) {
                      setFormData({ ...formData, category: enumVal, custom_category: v });
                    } else {
                      // For any new dynamic category, store name in custom_category and use a default enum
                      setFormData({ ...formData, category: "office_assets" as AssetCategory, custom_category: v });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {dynamicCategories.map((cat: any) => (
                      <SelectItem key={cat.id} value={cat.name}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData({ ...formData, status: v as AssetStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={formData.department_id}
                  onValueChange={(v) => setFormData({ ...formData, department_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Location Description</Label>
                <Input
                  value={formData.location_description}
                  onChange={(e) => setFormData({ ...formData, location_description: e.target.value })}
                  placeholder="e.g., Ground Floor, Room 101"
                />
              </div>
              <div className="space-y-2">
                <Label>Purchase Date</Label>
                <Input
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Purchase Price</Label>
                <Input
                  type="number"
                  value={formData.purchase_price}
                  onChange={(e) => setFormData({ ...formData, purchase_price: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Current Value</Label>
                <Input
                  type="number"
                  value={formData.current_value}
                  onChange={(e) => setFormData({ ...formData, current_value: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Warranty Expiry</Label>
                <Input
                  type="date"
                  value={formData.warranty_expiry}
                  onChange={(e) => setFormData({ ...formData, warranty_expiry: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Serial Number</Label>
                <Input
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Manufacturer</Label>
                <Input
                  value={formData.manufacturer}
                  onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Supplier Name</Label>
                <Input
                  value={formData.supplier_name}
                  onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice Number</Label>
                <Input
                  value={formData.invoice_number}
                  onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Responsible Person</Label>
                <Input
                  value={formData.responsible_person}
                  onChange={(e) => setFormData({ ...formData, responsible_person: e.target.value })}
                  placeholder="Person responsible for this asset"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {selectedAsset ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Asset Details</DialogTitle>
            </DialogHeader>
            {selectedAsset && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Asset Code</p>
                    <p className="font-medium">{selectedAsset.asset_code}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Name</p>
                    <p className="font-medium">{selectedAsset.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Category</p>
                    <p className="font-medium">
                      {CATEGORY_OPTIONS.find((c) => c.value === selectedAsset.category)?.label}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant={getStatusVariant(selectedAsset.status)}>
                      {STATUS_OPTIONS.find((s) => s.value === selectedAsset.status)?.label}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Department</p>
                    <p className="font-medium">{selectedAsset.production_departments?.name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Location</p>
                    <p className="font-medium">{selectedAsset.location_description || "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Purchase Date</p>
                    <p className="font-medium">
                      {selectedAsset.purchase_date
                        ? format(new Date(selectedAsset.purchase_date), "dd MMM yyyy")
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Purchase Price</p>
                    <p className="font-medium">₹{Number(selectedAsset.purchase_price).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Current Value</p>
                    <p className="font-semibold text-primary">
                      ₹{Number(selectedAsset.current_value).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Depreciation</p>
                    <p className="font-medium text-amber-600">
                      ₹{(Number(selectedAsset.purchase_price) - Number(selectedAsset.current_value)).toLocaleString()}
                    </p>
                  </div>
                  {selectedAsset.serial_number && (
                    <div>
                      <p className="text-muted-foreground">Serial Number</p>
                      <p className="font-medium">{selectedAsset.serial_number}</p>
                    </div>
                  )}
                  {selectedAsset.manufacturer && (
                    <div>
                      <p className="text-muted-foreground">Manufacturer</p>
                      <p className="font-medium">{selectedAsset.manufacturer}</p>
                    </div>
                  )}
                  {selectedAsset.model && (
                    <div>
                      <p className="text-muted-foreground">Model</p>
                      <p className="font-medium">{selectedAsset.model}</p>
                    </div>
                  )}
                  {selectedAsset.warranty_expiry && (
                    <div>
                      <p className="text-muted-foreground">Warranty Expiry</p>
                      <p className="font-medium">
                        {format(new Date(selectedAsset.warranty_expiry), "dd MMM yyyy")}
                      </p>
                    </div>
                  )}
                  {selectedAsset.responsible_person && (
                    <div>
                      <p className="text-muted-foreground">Responsible Person</p>
                      <p className="font-medium">{selectedAsset.responsible_person}</p>
                    </div>
                  )}
                </div>
                {selectedAsset.description && (
                  <div>
                    <p className="text-muted-foreground text-sm">Description</p>
                    <p className="text-sm">{selectedAsset.description}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Asset</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedAsset?.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => selectedAsset && deleteMutation.mutate(selectedAsset.id)}
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
