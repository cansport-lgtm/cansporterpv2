import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Package } from "lucide-react";
import { toast } from "sonner";

export default function DomesticItemOpeningPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [openingQty, setOpeningQty] = useState("");

  // Fetch products with unit info
  const { data: products = [] } = useQuery({
    queryKey: ["products-for-opening"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, units:uom_id(name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Array<{
        id: string;
        code: string;
        name: string;
        units: { name: string } | null;
      }>;
    },
  });

  // Fetch existing item openings from inventory_stock for domestic segment
  const { data: itemOpenings = [], refetch } = useQuery({
    queryKey: ["domestic-item-openings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select(`
          id,
          item_id,
          item_type,
          quantity,
          unit_cost,
          created_at,
          updated_at
        `)
        .eq("item_type", "product")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Get product details for display
  const getProductDetails = (itemId: string) => {
    return products.find((p) => p.id === itemId);
  };

  const filteredOpenings = itemOpenings.filter((item) => {
    const product = getProductDetails(item.item_id);
    if (!product) return false;
    const searchLower = searchTerm.toLowerCase();
    return (
      product.name.toLowerCase().includes(searchLower) ||
      product.code.toLowerCase().includes(searchLower)
    );
  });

  const handleAddOpening = async () => {
    if (!selectedProduct || !openingQty) {
      toast.error("Please fill all required fields");
      return;
    }

    const qty = parseFloat(openingQty);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    try {
      // Check if entry already exists
      const { data: existing } = await supabase
        .from("inventory_stock")
        .select("id")
        .eq("item_id", selectedProduct)
        .eq("item_type", "product")
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from("inventory_stock")
          .update({ quantity: qty, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Opening quantity updated successfully");
      } else {
        // Insert new
        const { error } = await supabase.from("inventory_stock").insert({
          item_id: selectedProduct,
          item_type: "product",
          quantity: qty,
        });
        if (error) throw error;
        toast.success("Opening quantity added successfully");
      }

      setIsDialogOpen(false);
      setSelectedProduct("");
      setOpeningQty("");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to save opening quantity");
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Item Opening</h1>
            <p className="text-muted-foreground">
              Manage opening stock quantities for domestic sales items
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Opening
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Item Opening</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="product">Product *</Label>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.code} - {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity">Opening Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingQty}
                    onChange={(e) => setOpeningQty(e.target.value)}
                    placeholder="Enter opening quantity"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddOpening}>Save</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by product name or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Opening Stock Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Code</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Opening Qty</TableHead>
                    <TableHead>Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOpenings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No item openings found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOpenings.map((item) => {
                      const product = getProductDetails(item.item_id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            {product?.code || "-"}
                          </TableCell>
                          <TableCell>{product?.name || "-"}</TableCell>
                          <TableCell>{product?.units?.name || "-"}</TableCell>
                          <TableCell className="text-right font-medium">
                            {item.quantity.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {item.updated_at
                              ? new Date(item.updated_at).toLocaleDateString()
                              : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
