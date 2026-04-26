 import { useState } from "react";
 import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { ERPLayout } from "@/components/layout/ERPLayout";
 import { PageHeader } from "@/components/shared/PageHeader";
 import { DataTable } from "@/components/shared/DataTable";
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
   DialogFooter,
 } from "@/components/ui/dialog";
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from "@/components/ui/select";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Badge } from "@/components/ui/badge";
 import { toast } from "sonner";
 import { Database, Plus, Pencil, Trash2, FolderOpen, Receipt } from "lucide-react";
 
 interface ExpenseCategory {
   id: string;
   code: string;
   name: string;
   category_type: string;
   description: string | null;
   is_active: boolean | null;
   created_at: string | null;
 }
 
 const categoryTypes = [
   { value: "general", label: "General Expense" },
   { value: "petty_cash", label: "Petty Cash" },
   { value: "utility", label: "Utility" },
   { value: "maintenance", label: "Maintenance" },
   { value: "travel", label: "Travel" },
   { value: "office", label: "Office Supplies" },
   { value: "other", label: "Other" },
 ];
 
 export default function ExpenseMasterPage() {
   const queryClient = useQueryClient();
   const [isDialogOpen, setIsDialogOpen] = useState(false);
   const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
   const [activeTab, setActiveTab] = useState("all");
   const [formData, setFormData] = useState({
     code: "",
     name: "",
     category_type: "general",
     description: "",
     is_active: true,
   });
 
  const { data: categories = [] } = useQuery({
     queryKey: ["expense-categories"],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("expense_categories")
         .select("*")
         .order("category_type")
         .order("name");
       if (error) throw error;
       return data as ExpenseCategory[];
     },
   });
 
   const saveMutation = useMutation({
     mutationFn: async (data: typeof formData) => {
       if (editingCategory) {
         const { error } = await supabase
           .from("expense_categories")
           .update(data)
           .eq("id", editingCategory.id);
         if (error) throw error;
       } else {
         const { error } = await supabase.from("expense_categories").insert(data);
         if (error) throw error;
       }
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
       toast.success(editingCategory ? "Category updated" : "Category created");
       handleCloseDialog();
     },
     onError: (error: Error) => {
       toast.error(error.message);
     },
   });
 
   const deleteMutation = useMutation({
     mutationFn: async (id: string) => {
       const { error } = await supabase.from("expense_categories").delete().eq("id", id);
       if (error) throw error;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
       toast.success("Category deleted");
     },
     onError: (error: Error) => {
       toast.error(error.message);
     },
   });
 
   const handleOpenDialog = (category?: ExpenseCategory) => {
     if (category) {
       setEditingCategory(category);
       setFormData({
         code: category.code,
         name: category.name,
         category_type: category.category_type,
         description: category.description || "",
         is_active: category.is_active ?? true,
       });
     } else {
       setEditingCategory(null);
       setFormData({
         code: "",
         name: "",
         category_type: "general",
         description: "",
         is_active: true,
       });
     }
     setIsDialogOpen(true);
   };
 
   const handleCloseDialog = () => {
     setIsDialogOpen(false);
     setEditingCategory(null);
     setFormData({
       code: "",
       name: "",
       category_type: "general",
       description: "",
       is_active: true,
     });
   };
 
   const handleSubmit = (e: React.FormEvent) => {
     e.preventDefault();
     if (!formData.code || !formData.name) {
       toast.error("Code and Name are required");
       return;
     }
     saveMutation.mutate(formData);
   };
 
   const filteredCategories = categories.filter((cat) => {
     if (activeTab === "all") return true;
     return cat.category_type === activeTab;
   });
 
   const getCategoryTypeLabel = (type: string) => {
     return categoryTypes.find((t) => t.value === type)?.label || type;
   };
 
   const getCategoryStats = () => {
     const total = categories.length;
     const active = categories.filter((c) => c.is_active).length;
     const byType = categoryTypes.map((type) => ({
       ...type,
       count: categories.filter((c) => c.category_type === type.value).length,
     }));
     return { total, active, byType };
   };
 
   const stats = getCategoryStats();
 
   const columns = [
     {
       key: "code",
       header: "Code",
       render: (item: ExpenseCategory) => (
         <span className="font-mono font-medium">{item.code}</span>
       ),
     },
     {
       key: "name",
       header: "Category Name",
       render: (item: ExpenseCategory) => (
         <span className="font-medium">{item.name}</span>
       ),
     },
     {
       key: "category_type",
       header: "Type",
       render: (item: ExpenseCategory) => (
         <Badge variant="outline">{getCategoryTypeLabel(item.category_type)}</Badge>
       ),
     },
     {
       key: "description",
       header: "Description",
       render: (item: ExpenseCategory) => (
         <span className="text-muted-foreground text-sm">
           {item.description || "-"}
         </span>
       ),
     },
     {
       key: "is_active",
       header: "Status",
       render: (item: ExpenseCategory) => (
         <Badge variant={item.is_active ? "default" : "secondary"}>
           {item.is_active ? "Active" : "Inactive"}
         </Badge>
       ),
     },
     {
       key: "actions",
       header: "Actions",
       render: (item: ExpenseCategory) => (
         <div className="flex items-center gap-2">
           <Button
             variant="ghost"
             size="icon"
             onClick={(e) => {
               e.stopPropagation();
               handleOpenDialog(item);
             }}
           >
             <Pencil className="h-4 w-4" />
           </Button>
           <Button
             variant="ghost"
             size="icon"
             onClick={(e) => {
               e.stopPropagation();
               if (confirm("Delete this category?")) {
                 deleteMutation.mutate(item.id);
               }
             }}
           >
             <Trash2 className="h-4 w-4 text-destructive" />
           </Button>
         </div>
       ),
     },
   ];
 
   return (
     <ERPLayout>
       <div className="space-y-6">
         <PageHeader
           title="Expense Master"
           description="Manage expense categories for all expense types"
           icon={Database}
           iconColor="bg-yellow-500/10 text-yellow-500"
           action={{
             label: "Add Category",
             onClick: () => handleOpenDialog(),
             icon: Plus,
           }}
         />
 
         {/* Stats Cards */}
         <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
           <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium text-muted-foreground">
                 Total Categories
               </CardTitle>
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{stats.total}</div>
             </CardContent>
           </Card>
           <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium text-muted-foreground">
                 Active
               </CardTitle>
             </CardHeader>
             <CardContent>
              <div className="text-2xl font-bold text-primary">{stats.active}</div>
             </CardContent>
           </Card>
           {stats.byType
             .filter((t) => t.count > 0)
             .slice(0, 4)
             .map((type) => (
               <Card key={type.value}>
                 <CardHeader className="pb-2">
                   <CardTitle className="text-sm font-medium text-muted-foreground">
                     {type.label}
                   </CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className="text-2xl font-bold">{type.count}</div>
                 </CardContent>
               </Card>
             ))}
         </div>
 
         {/* Tabs for filtering */}
         <Tabs value={activeTab} onValueChange={setActiveTab}>
           <TabsList>
             <TabsTrigger value="all">
               <FolderOpen className="h-4 w-4 mr-2" />
               All Categories
             </TabsTrigger>
             <TabsTrigger value="general">
               <Receipt className="h-4 w-4 mr-2" />
               General Expense
             </TabsTrigger>
             <TabsTrigger value="petty_cash">Petty Cash</TabsTrigger>
             <TabsTrigger value="utility">Utility</TabsTrigger>
             <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
             <TabsTrigger value="travel">Travel</TabsTrigger>
             <TabsTrigger value="office">Office</TabsTrigger>
           </TabsList>
 
           <TabsContent value={activeTab} className="mt-4">
             <DataTable
               columns={columns}
               data={filteredCategories}
               emptyMessage="No expense categories found"
             />
           </TabsContent>
         </Tabs>
       </div>
 
       {/* Add/Edit Dialog */}
       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
         <DialogContent>
           <DialogHeader>
             <DialogTitle>
               {editingCategory ? "Edit Category" : "Add Expense Category"}
             </DialogTitle>
           </DialogHeader>
           <form onSubmit={handleSubmit} className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <Label htmlFor="code">Code *</Label>
                 <Input
                   id="code"
                   value={formData.code}
                   onChange={(e) =>
                     setFormData({ ...formData, code: e.target.value.toUpperCase() })
                   }
                   placeholder="e.g., TRV-001"
                 />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="name">Category Name *</Label>
                 <Input
                   id="name"
                   value={formData.name}
                   onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                   placeholder="e.g., Travel Allowance"
                 />
               </div>
             </div>
 
             <div className="space-y-2">
               <Label htmlFor="category_type">Category Type *</Label>
               <Select
                 value={formData.category_type}
                 onValueChange={(value) =>
                   setFormData({ ...formData, category_type: value })
                 }
               >
                 <SelectTrigger>
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   {categoryTypes.map((type) => (
                     <SelectItem key={type.value} value={type.value}>
                       {type.label}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
 
             <div className="space-y-2">
               <Label htmlFor="description">Description</Label>
               <Textarea
                 id="description"
                 value={formData.description}
                 onChange={(e) =>
                   setFormData({ ...formData, description: e.target.value })
                 }
                 placeholder="Optional description..."
                 rows={3}
               />
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
 
             <DialogFooter>
               <Button type="button" variant="outline" onClick={handleCloseDialog}>
                 Cancel
               </Button>
               <Button type="submit" disabled={saveMutation.isPending}>
                 {saveMutation.isPending
                   ? "Saving..."
                   : editingCategory
                   ? "Update"
                   : "Create"}
               </Button>
             </DialogFooter>
           </form>
         </DialogContent>
       </Dialog>
     </ERPLayout>
   );
 }