import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Eye, Edit2, Search, PlusCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { OrderManagementLayout } from "@/components/layout/OrderManagementLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Packing options with labels and dozen multipliers
const PACKING_OPTIONS = [
  { value: "12_dz_ctns", label: "12 Dz Ctns", multiplier: 12 },
  { value: "20_dz_bag", label: "20 Dz Bag", multiplier: 20 },
  { value: "60_dz_bag", label: "60 Dz Bag", multiplier: 60 },
  { value: "20_dz_ctn", label: "20 Dz Ctn", multiplier: 20 },
  { value: "6_dz_ctn", label: "6 Dz Ctn", multiplier: 6 },
] as const;

type PackingOption = typeof PACKING_OPTIONS[number]["value"];

const getPackingMultiplier = (packingType: string): number => {
  return PACKING_OPTIONS.find((opt) => opt.value === packingType)?.multiplier || 12;
};

interface OrderItem {
  id?: string;
  product_id: string;
  grade_id: string;
  quantity_dozens: number;
  packing_type: PackingOption;
  num_bags_ctn: number;
  remarks: string;
  // For display
  product_name?: string;
  grade_name?: string;
}

interface ProductionOrder {
  id: string;
  order_number: string;
  customer_id: string | null;
  order_date: string;
  due_date: string | null;
  priority: string;
  status: string;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  customers?: { name: string; code: string } | null;
  created_by_user?: { full_name: string } | null;
  production_order_items?: {
    id: string;
    product_id: string;
    grade_id: string;
    quantity_dozens: number;
    packing_type: string;
    quantity_produced: number;
    remarks: string | null;
    products?: { name: string; code: string } | null;
    grades?: { name: string; code: string } | null;
  }[];
}

const priorityColors: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

export default function ProductionOrdersPage() {
  const { toast } = useToast();
  const { user, roles, hasModulePermission } = useAuth();
  const queryClient = useQueryClient();

  const isOrderManagement = roles.some((r) => r.role === "order_management");
  const canCreate = hasModulePermission("production", "create");
  const canEditOrders = hasModulePermission("production", "edit");
  const Layout = isOrderManagement ? OrderManagementLayout : ERPLayout;
  const isMobile = useIsMobile();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<ProductionOrder | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Form state
  const [formData, setFormData] = useState({
    customer_id: "",
    order_date: format(new Date(), "yyyy-MM-dd"),
    due_date: "",
    priority: "medium",
    remarks: "",
  });

  // Order items state
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

  // New customer form state
  const [newCustomer, setNewCustomer] = useState({
    code: "",
    name: "",
    contact_person: "",
    phone: "",
  });

  // New product form state
  const [newProduct, setNewProduct] = useState({
    code: "",
    name: "",
    grade_id: "",
    description: "",
  });

  // Fetch production orders with items
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["production-orders", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("production_orders")
        .select(`
          *,
          customers(name, code),
          created_by_user:app_users!production_orders_created_by_fkey(full_name),
          production_order_items(
            id,
            product_id,
            grade_id,
            quantity_dozens,
            packing_type,
            quantity_produced,
            remarks,
            products(name, code),
            grades(name, code)
          )
        `)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ProductionOrder[];
    },
  });

  // Fetch master data
  const { data: customers = [], refetch: refetchCustomers } = useQuery({
    queryKey: ["customers-domestic-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, code")
        .eq("is_active", true)
        .eq("sales_segment", "domestic")
        .order("name");
      return data || [];
    },
  });

  const { data: products = [], refetch: refetchProducts } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, code, grade_id")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (data: typeof newCustomer) => {
      if (isOrderManagement) {
        throw new Error("View-only access");
      }

      const { data: result, error } = await supabase
        .from("customers")
        .insert({
          code: data.code,
          name: data.name,
          contact_person: data.contact_person || null,
          phone: data.phone || null,
          sales_segment: "domestic",
        })
        .select("id")
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: (result) => {
      refetchCustomers();
      setFormData((prev) => ({ ...prev, customer_id: result.id }));
      setIsAddCustomerOpen(false);
      setNewCustomer({ code: "", name: "", contact_person: "", phone: "" });
      toast({ title: "Customer Added", description: "New customer has been created." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Create product mutation
  const createProductMutation = useMutation({
    mutationFn: async (data: typeof newProduct) => {
      if (isOrderManagement) {
        throw new Error("View-only access");
      }

      const { data: result, error } = await supabase
        .from("products")
        .insert({
          code: data.code,
          name: data.name,
          grade_id: data.grade_id || null,
          description: data.description || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      refetchProducts();
      setIsAddProductOpen(false);
      setNewProduct({ code: "", name: "", grade_id: "", description: "" });
      toast({ title: "Product Added", description: "New product has been created." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Save order mutation
  const saveMutation = useMutation({
    mutationFn: async (data: { formData: typeof formData; items: OrderItem[]; orderId?: string }) => {
      if (isOrderManagement) {
        throw new Error("View-only access");
      }

      const orderPayload = {
        customer_id: data.formData.customer_id || null,
        order_date: data.formData.order_date,
        due_date: data.formData.due_date || null,
        priority: data.formData.priority,
        remarks: data.formData.remarks || null,
        created_by: user?.id || null,
      };

      let orderId = data.orderId;

      if (orderId) {
        // Update existing order
        const { error } = await supabase
          .from("production_orders")
          .update(orderPayload)
          .eq("id", orderId);
        if (error) throw error;

        // Delete existing items and re-insert
        await supabase.from("production_order_items").delete().eq("order_id", orderId);
      } else {
        // Create new order
        const { data: newOrder, error } = await supabase
          .from("production_orders")
          .insert({ ...orderPayload, order_number: "" })
          .select("id")
          .single();
        if (error) throw error;
        orderId = newOrder.id;
      }

      // Insert items
      if (data.items.length > 0) {
        const itemsPayload = data.items.map((item) => ({
          order_id: orderId,
          product_id: item.product_id || null,
          grade_id: item.grade_id || null,
          quantity_dozens: item.quantity_dozens,
          packing_type: item.packing_type,
          remarks: item.remarks || null,
        }));

        const { error: itemsError } = await supabase
          .from("production_order_items")
          .insert(itemsPayload);
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-orders"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: selectedOrder ? "Order Updated" : "Order Created",
        description: selectedOrder
          ? "Production order has been updated successfully."
          : "New production order has been created.",
      });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (isOrderManagement) {
        throw new Error("View-only access");
      }

      const { error } = await supabase
        .from("production_orders")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-orders"] });
      toast({ title: "Status Updated" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete order mutation
  const deleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (isOrderManagement) {
        throw new Error("View-only access");
      }

      // First delete order items
      const { error: itemsError } = await supabase
        .from("production_order_items")
        .delete()
        .eq("order_id", orderId);
      if (itemsError) throw itemsError;

      // Then delete the order
      const { error } = await supabase
        .from("production_orders")
        .delete()
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-orders"] });
      setIsDeleteDialogOpen(false);
      setOrderToDelete(null);
      toast({ title: "Order Deleted", description: "Production order has been deleted." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleDeleteClick = (order: ProductionOrder) => {
    if (isOrderManagement) {
      toast({
        title: "View Only",
        description: "Order Management users can only view production orders.",
        variant: "destructive",
      });
      return;
    }

    setOrderToDelete(order);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (orderToDelete) {
      deleteMutation.mutate(orderToDelete.id);
    }
  };

  const resetForm = () => {
    setFormData({
      customer_id: "",
      order_date: format(new Date(), "yyyy-MM-dd"),
      due_date: "",
      priority: "medium",
      remarks: "",
    });
    setOrderItems([]);
    setSelectedOrder(null);
  };

  const handleOpenCreate = () => {
    if (isOrderManagement) {
      toast({
        title: "View Only",
        description: "Order Management users can only view production orders.",
        variant: "destructive",
      });
      return;
    }

    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (order: ProductionOrder) => {
    if (isOrderManagement) {
      toast({
        title: "View Only",
        description: "Order Management users can only view production orders.",
        variant: "destructive",
      });
      return;
    }

    setSelectedOrder(order);
    setFormData({
      customer_id: order.customer_id || "",
      order_date: order.order_date,
      due_date: order.due_date || "",
      priority: order.priority,
      remarks: order.remarks || "",
    });
    // Load existing items
    const items: OrderItem[] = (order.production_order_items || []).map((item) => {
      const multiplier = getPackingMultiplier(item.packing_type);
      const inferredBags = multiplier > 0 ? Math.round(item.quantity_dozens / multiplier) : 0;
      return {
        id: item.id,
        product_id: item.product_id,
        grade_id: item.grade_id,
        quantity_dozens: item.quantity_dozens,
        packing_type: item.packing_type as PackingOption,
        num_bags_ctn: inferredBags || 1,
        remarks: item.remarks || "",
        product_name: item.products?.name,
        grade_name: item.grades?.name,
      };
    });
    setOrderItems(items);
    setIsDialogOpen(true);
  };

  const handleView = (order: ProductionOrder) => {
    setSelectedOrder(order);
    setIsViewDialogOpen(true);
  };

  const handleAddItem = () => {
    setOrderItems((prev) => [
      ...prev,
      {
        product_id: "",
        grade_id: "",
        quantity_dozens: 0,
        packing_type: "12_dz_ctns",
        num_bags_ctn: 0,
        remarks: "",
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof OrderItem, value: string | number) => {
    setOrderItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        
        // Auto-fill grade when product is selected
        if (field === "product_id") {
          const product = products.find((p) => p.id === value);
          if (product?.grade_id) {
            updated.grade_id = product.grade_id;
          }
        }
        
        // Auto-calculate quantity when packing or num_bags_ctn changes
        if (field === "packing_type") {
          const multiplier = getPackingMultiplier(value as string);
          updated.quantity_dozens = updated.num_bags_ctn * multiplier;
        }
        if (field === "num_bags_ctn") {
          const multiplier = getPackingMultiplier(updated.packing_type);
          updated.quantity_dozens = (value as number) * multiplier;
        }
        
        return updated;
      })
    );
  };

  const handleSubmit = () => {
    if (isOrderManagement) {
      toast({
        title: "View Only",
        description: "Order Management users can only view production orders.",
        variant: "destructive",
      });
      return;
    }

    if (orderItems.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one item to the order.",
        variant: "destructive",
      });
      return;
    }

    const hasValidItems = orderItems.every(
      (item) => item.product_id && item.quantity_dozens > 0 && item.packing_type
    );

    if (!hasValidItems) {
      toast({
        title: "Validation Error",
        description: "Please fill in product, quantity, and packing for all items.",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate({
      formData,
      items: orderItems,
      orderId: selectedOrder?.id,
    });
  };

  const filteredOrders = orders.filter((order) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.order_number.toLowerCase().includes(search) ||
      order.customers?.name.toLowerCase().includes(search)
    );
  });

  const getPackingLabel = (value: string) => {
    return PACKING_OPTIONS.find((opt) => opt.value === value)?.label || value;
  };

  const getTotalItems = (order: ProductionOrder) => {
    return order.production_order_items?.length || 0;
  };

  const getTotalDozens = (order: ProductionOrder) => {
    return (
      order.production_order_items?.reduce((sum, item) => sum + item.quantity_dozens, 0) || 0
    );
  };

  const renderExpandedRow = (order: ProductionOrder) => {
    const items = order.production_order_items || [];
    if (items.length === 0) {
      return (
        <div className="p-4 text-center text-muted-foreground text-sm">
          No items in this order
        </div>
      );
    }
    return (
      <div className="p-4 pl-12">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="text-xs font-semibold">Product</TableHead>
              <TableHead className="text-xs font-semibold">Grade</TableHead>
              <TableHead className="text-xs font-semibold">Qty (Dz)</TableHead>
              <TableHead className="text-xs font-semibold">Packing</TableHead>
              <TableHead className="text-xs font-semibold">Produced</TableHead>
              <TableHead className="text-xs font-semibold">Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, idx) => (
              <TableRow key={item.id || idx} className="hover:bg-transparent">
                <TableCell className="text-sm">
                  {item.products?.name || "-"}
                  {item.products?.code && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({item.products.code})
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{item.grades?.name || "-"}</TableCell>
                <TableCell className="text-sm font-medium">
                  {item.quantity_dozens.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm">{getPackingLabel(item.packing_type)}</TableCell>
                <TableCell className="text-sm">
                  {item.quantity_produced > 0 ? (
                    <span className="text-green-600 font-medium">
                      {item.quantity_produced.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {item.remarks || "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  // Mobile card view for orders
  const renderMobileCard = (order: ProductionOrder) => (
    <Card key={order.id} className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
              {order.order_number}
            </code>
            <p className="font-medium mt-1">{order.customers?.name || "No Customer"}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          <div>
            <span className="text-muted-foreground">Items:</span>{" "}
            <span className="font-medium">{getTotalItems(order)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Qty:</span>{" "}
            <span className="font-medium">{getTotalDozens(order).toLocaleString()} Dz</span>
          </div>
          <div>
            <span className="text-muted-foreground">Due:</span>{" "}
            <span className="font-medium">
              {order.due_date ? format(new Date(order.due_date), "dd MMM") : "-"}
            </span>
          </div>
          <div>
            <Badge className={priorityColors[order.priority] || ""} variant="secondary">
              {order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
            </Badge>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => handleView(order)}>
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          {!isOrderManagement && canEditOrders && (order.status === "draft" || order.status === "in_progress") && (
            <Button variant="outline" size="sm" className="flex-1" onClick={() => handleOpenEdit(order)}>
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const columns = [
    {
      key: "order_number",
      header: "Order #",
      render: (row: ProductionOrder) => (
        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
          {row.order_number}
        </code>
      ),
    },
    {
      key: "customers",
      header: "Customer",
      render: (row: ProductionOrder) => row.customers?.name || "-",
    },
    {
      key: "items",
      header: "Items",
      render: (row: ProductionOrder) => `${getTotalItems(row)} items`,
    },
    {
      key: "quantity",
      header: "Total Qty (Dz)",
      render: (row: ProductionOrder) => `${getTotalDozens(row).toLocaleString()} Dz`,
    },
    {
      key: "due_date",
      header: "Due Date",
      render: (row: ProductionOrder) =>
        row.due_date ? format(new Date(row.due_date), "dd MMM yyyy") : "-",
    },
    {
      key: "priority",
      header: "Priority",
      render: (row: ProductionOrder) => (
        <Badge className={priorityColors[row.priority] || ""}>
          {row.priority.charAt(0).toUpperCase() + row.priority.slice(1)}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: ProductionOrder) => <StatusBadge status={row.status} />,
    },
    {
      key: "created_by_user",
      header: "Created By",
      render: (row: ProductionOrder) => row.created_by_user?.full_name || "-",
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: ProductionOrder) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleView(row)}
            title="View"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {!isOrderManagement && canEditOrders && (row.status === "draft" || row.status === "in_progress") && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleOpenEdit(row)}
              title="Edit"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <PageHeader
        title="Production Orders"
        description="Manage production orders and track progress"
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search orders..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <div className="flex-1 sm:w-[150px]">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isOrderManagement && canCreate && (
                <Button onClick={handleOpenCreate} className="self-end">
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">New Order</span>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders - Mobile Cards or Desktop Table */}
      {isMobile ? (
        <div className="space-y-0">
          {filteredOrders.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No orders found
              </CardContent>
            </Card>
          ) : (
            filteredOrders.map(renderMobileCard)
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable 
              columns={columns} 
              data={filteredOrders} 
              expandedRowRender={renderExpandedRow}
            />
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={!isOrderManagement && isDialogOpen}
        onOpenChange={(open) => {
          if (isOrderManagement) return;
          setIsDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedOrder ? "Edit Production Order" : "New Production Order"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Order Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Customer</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddCustomerOpen(true)}
                    className="h-6 text-xs"
                  >
                    <PlusCircle className="h-3 w-3 mr-1" />
                    Add New
                  </Button>
                </div>
                <Select
                  value={formData.customer_id}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, customer_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Order Date</Label>
                <Input
                  type="date"
                  value={formData.order_date}
                  onChange={(e) => setFormData((prev) => ({ ...prev, order_date: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, priority: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 md:col-span-3 space-y-2">
                <Label>Remarks</Label>
                <Input
                  value={formData.remarks}
                  onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                  placeholder="Enter any remarks..."
                />
              </div>
            </div>

            {/* Order Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Order Items</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddProductOpen(true)}
                  >
                    <PlusCircle className="h-4 w-4 mr-1" />
                    Add Product
                  </Button>
                  <Button type="button" size="sm" onClick={handleAddItem}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Product *</TableHead>
                      <TableHead className="w-[140px]">Packing *</TableHead>
                      <TableHead className="w-[100px]">No of Ctn/Bag *</TableHead>
                      <TableHead className="w-[100px]">Qty (Dz)</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No items added. Click "Add Item" to add products.
                        </TableCell>
                      </TableRow>
                    ) : (
                      orderItems.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="p-2">
                            <Select
                              value={item.product_id}
                              onValueChange={(v) => handleItemChange(index, "product_id", v)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.code} - {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="p-2">
                            <Select
                              value={item.packing_type}
                              onValueChange={(v) => handleItemChange(index, "packing_type", v)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Packing" />
                              </SelectTrigger>
                              <SelectContent>
                                {PACKING_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="p-2">
                            <Input
                              type="number"
                              value={item.num_bags_ctn || ""}
                              onChange={(e) =>
                                handleItemChange(index, "num_bags_ctn", parseInt(e.target.value) || 0)
                              }
                              className="h-9"
                              min="0"
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell className="p-2">
                            <Input
                              type="number"
                              value={item.quantity_dozens || 0}
                              readOnly
                              className="h-9 bg-muted"
                            />
                          </TableCell>
                          <TableCell className="p-2">
                            <Input
                              value={item.remarks}
                              onChange={(e) => handleItemChange(index, "remarks", e.target.value)}
                              className="h-9"
                              placeholder="Optional"
                            />
                          </TableCell>
                          <TableCell className="p-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(index)}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {orderItems.length > 0 && (
                <div className="flex justify-end">
                  <div className="text-sm text-muted-foreground">
                    Total: <span className="font-medium text-foreground">
                      {orderItems.reduce((sum, item) => sum + (item.quantity_dozens || 0), 0).toLocaleString()} Dz
                    </span> in <span className="font-medium text-foreground">{orderItems.length}</span> items
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending
                ? "Saving..."
                : selectedOrder
                ? "Update Order"
                : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Customer Dialog */}
      <Dialog
        open={!isOrderManagement && isAddCustomerOpen}
        onOpenChange={(open) => {
          if (isOrderManagement) return;
          setIsAddCustomerOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Customer Code *</Label>
              <Input
                value={newCustomer.code}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="e.g., CUST001"
              />
            </div>
            <div className="space-y-2">
              <Label>Customer Name *</Label>
              <Input
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter customer name"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Person</Label>
              <Input
                value={newCustomer.contact_person}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, contact_person: e.target.value }))}
                placeholder="Enter contact person"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="Enter phone number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddCustomerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createCustomerMutation.mutate(newCustomer)}
              disabled={!newCustomer.code || !newCustomer.name || createCustomerMutation.isPending}
            >
              {createCustomerMutation.isPending ? "Adding..." : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog
        open={!isOrderManagement && isAddProductOpen}
        onOpenChange={(open) => {
          if (isOrderManagement) return;
          setIsAddProductOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Product Code *</Label>
              <Input
                value={newProduct.code}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="e.g., PROD001"
              />
            </div>
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input
                value={newProduct.name}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter product name"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Grade</Label>
              <Select
                value={newProduct.grade_id}
                onValueChange={(v) => setNewProduct((prev) => ({ ...prev, grade_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {grades.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.code} - {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={newProduct.description}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Enter description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddProductOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createProductMutation.mutate(newProduct)}
              disabled={!newProduct.code || !newProduct.name || createProductMutation.isPending}
            >
              {createProductMutation.isPending ? "Adding..." : "Add Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Production Order Details</DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              {/* Header - Stack on mobile */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <code className="text-base sm:text-lg font-mono bg-muted px-2 sm:px-3 py-1 rounded w-fit">
                  {selectedOrder.order_number}
                </code>
                <div className="flex items-center gap-2">
                  <Badge className={priorityColors[selectedOrder.priority]}>
                    {selectedOrder.priority.toUpperCase()}
                  </Badge>
                  <StatusBadge status={selectedOrder.status} />
                </div>
              </div>

              {/* Order Info Grid - 2 cols on mobile, 4 on desktop */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Customer:</span>
                  <p className="font-medium text-sm">{selectedOrder.customers?.name || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Order Date:</span>
                  <p className="font-medium text-sm">
                    {format(new Date(selectedOrder.order_date), "dd MMM yyyy")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Due Date:</span>
                  <p className="font-medium text-sm">
                    {selectedOrder.due_date
                      ? format(new Date(selectedOrder.due_date), "dd MMM yyyy")
                      : "-"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Total Qty:</span>
                  <p className="font-medium text-sm">{getTotalDozens(selectedOrder).toLocaleString()} Dz</p>
                </div>
              </div>

              {/* Items - Cards on mobile, Table on desktop */}
              {isMobile ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Order Items</Label>
                  {(selectedOrder.production_order_items || []).map((item, index) => (
                    <Card key={index} className="bg-muted/30">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-medium text-sm">{item.products?.name || "-"}</p>
                            <p className="text-xs text-muted-foreground">{item.grades?.code || "-"}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {item.quantity_dozens.toLocaleString()} Dz
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Packing:</span>
                            <span className="ml-1">{getPackingLabel(item.packing_type)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Produced:</span>
                            <span className="ml-1 text-green-600 font-medium">
                              {item.quantity_produced.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {item.remarks && (
                          <p className="text-xs text-muted-foreground mt-2 truncate">
                            {item.remarks}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Qty (Dz)</TableHead>
                        <TableHead>Packing</TableHead>
                        <TableHead>Produced</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedOrder.production_order_items || []).map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>{item.products?.name || "-"}</TableCell>
                          <TableCell>{item.grades?.code || "-"}</TableCell>
                          <TableCell>{item.quantity_dozens.toLocaleString()}</TableCell>
                          <TableCell>{getPackingLabel(item.packing_type)}</TableCell>
                          <TableCell>{item.quantity_produced.toLocaleString()}</TableCell>
                          <TableCell className="text-muted-foreground">{item.remarks || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {selectedOrder.remarks && (
                <div>
                  <span className="text-muted-foreground text-sm">Remarks:</span>
                  <p className="font-medium">{selectedOrder.remarks}</p>
                </div>
              )}

              {/* Status Actions - hidden for order_management role */}
              {!isOrderManagement && selectedOrder.status !== "completed" && selectedOrder.status !== "cancelled" && (
                <div className="border-t pt-4">
                  <Label className="text-xs text-muted-foreground mb-2 block">Update Status</Label>
                  <div className="flex gap-2">
                    {selectedOrder.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          updateStatusMutation.mutate({ id: selectedOrder.id, status: "in_progress" })
                        }
                      >
                        Start Production
                      </Button>
                    )}
                    {selectedOrder.status === "in_progress" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateStatusMutation.mutate({ id: selectedOrder.id, status: "on_hold" })
                          }
                        >
                          Put On Hold
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            updateStatusMutation.mutate({ id: selectedOrder.id, status: "completed" })
                          }
                        >
                          Mark Complete
                        </Button>
                      </>
                    )}
                    {selectedOrder.status === "on_hold" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          updateStatusMutation.mutate({ id: selectedOrder.id, status: "in_progress" })
                        }
                      >
                        Resume Production
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        updateStatusMutation.mutate({ id: selectedOrder.id, status: "cancelled" })
                      }
                    >
                      Cancel Order
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!isOrderManagement && isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (isOrderManagement) return;
          setIsDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Production Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order{" "}
              <span className="font-mono font-bold">{orderToDelete?.order_number}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
