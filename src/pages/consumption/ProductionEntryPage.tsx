 import { useState } from "react";
 import { PageHeader } from "@/components/shared/PageHeader";
 import { ERPLayout } from "@/components/layout/ERPLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Save, CalendarIcon } from "lucide-react";
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
 import { Calendar } from "@/components/ui/calendar";
 import { format } from "date-fns";
 import { cn } from "@/lib/utils";
 import { toast } from "sonner";
 import { useAuth } from "@/contexts/AuthContext";
 
 interface ProductionEntry {
   product_id: string;
   code: string;
   name: string;
   quantity_produced: string;
   unit: string;
   existingId?: string;
 }
 
 export default function ProductionEntryPage() {
   const { user } = useAuth();
   const queryClient = useQueryClient();
   const [selectedDate, setSelectedDate] = useState<Date>(new Date());
   const [entries, setEntries] = useState<ProductionEntry[]>([]);
   const [isCalendarOpen, setIsCalendarOpen] = useState(false);
 
   const dateStr = format(selectedDate, "yyyy-MM-dd");
 
  // Fetch products from consumption_products
  const { data: products } = useQuery({
    queryKey: ["consumption-products-for-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_products")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });
 
   // Fetch existing entries for the date
   const { data: existingEntries, isLoading } = useQuery({
     queryKey: ["consumption-production-entry", dateStr],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("consumption_production_entry")
         .select("*")
         .eq("entry_date", dateStr);
       if (error) throw error;
       return data;
     },
     enabled: !!products,
   });
 
   // Build entries when data loads
   useQuery({
     queryKey: ["build-production-entries", dateStr, products?.length, existingEntries?.length],
     queryFn: async () => {
       if (products && existingEntries !== undefined) {
          const newEntries: ProductionEntry[] = products.map((prod) => {
            const existing = existingEntries?.find((e) => e.product_id === prod.id);
            return {
              product_id: prod.id,
              code: prod.code,
              name: prod.name,
              quantity_produced: existing ? String(existing.quantity_produced) : "",
              unit: existing?.unit || prod.unit || "pcs",
              existingId: existing?.id,
            };
          });
         setEntries(newEntries);
       }
       return null;
     },
     enabled: !!products && existingEntries !== undefined,
   });
 
   const saveMutation = useMutation({
     mutationFn: async () => {
       const toSave = entries.filter((e) => e.quantity_produced !== "" && parseFloat(e.quantity_produced) > 0);
 
       for (const entry of toSave) {
         if (entry.existingId) {
           const { error } = await supabase
             .from("consumption_production_entry")
             .update({
               quantity_produced: parseFloat(entry.quantity_produced),
               unit: entry.unit,
             })
             .eq("id", entry.existingId);
           if (error) throw error;
         } else {
           const { error } = await supabase
             .from("consumption_production_entry")
             .insert({
               entry_date: dateStr,
               product_id: entry.product_id,
               quantity_produced: parseFloat(entry.quantity_produced),
               unit: entry.unit,
               created_by: user?.id,
             });
           if (error) throw error;
         }
       }
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ["consumption-production-entry"] });
       toast.success("Production entries saved");
     },
     onError: (error: any) => {
       toast.error(error.message || "Failed to save");
     },
   });
 
   const updateEntry = (idx: number, value: string) => {
     const newEntries = [...entries];
     newEntries[idx] = { ...newEntries[idx], quantity_produced: value };
     setEntries(newEntries);
   };
 
   const totalProduction = entries.reduce((sum, e) => sum + (parseFloat(e.quantity_produced) || 0), 0);
 
   return (
     <ERPLayout>
       <div className="space-y-6">
         <div className="page-header">
           <div>
             <h1 className="page-title">Production Entry</h1>
             <p className="page-description">Record daily production quantities for consumption calculation</p>
           </div>
           <div className="flex gap-2 items-center">
               <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                 <PopoverTrigger asChild>
                   <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                     <CalendarIcon className="mr-2 h-4 w-4" />
                     {format(selectedDate, "PPP")}
                   </Button>
                 </PopoverTrigger>
                 <PopoverContent className="w-auto p-0" align="end">
                   <Calendar
                     mode="single"
                     selected={selectedDate}
                     onSelect={(date) => {
                       if (date) {
                         setSelectedDate(date);
                         setIsCalendarOpen(false);
                       }
                     }}
                     disabled={(date) => date > new Date()}
                     initialFocus
                     className={cn("p-3 pointer-events-auto")}
                   />
                 </PopoverContent>
               </Popover>
               <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                 <Save className="mr-2 h-4 w-4" />
                 {saveMutation.isPending ? "Saving..." : "Save All"}
               </Button>
             </div>
         </div>
 
         <Card>
           <CardHeader>
             <CardTitle className="flex justify-between">
               <span>Production for {format(selectedDate, "MMMM d, yyyy")}</span>
               <span className="text-muted-foreground">Total: {totalProduction.toFixed(2)} dzns</span>
             </CardTitle>
           </CardHeader>
           <CardContent>
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Code</TableHead>
                   <TableHead>Product</TableHead>
                   <TableHead className="text-right">Quantity Produced</TableHead>
                   <TableHead>Unit</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={4} className="text-center">Loading...</TableCell>
                   </TableRow>
                 ) : entries.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={4} className="text-center text-muted-foreground">
                       No products found. Add products first.
                     </TableCell>
                   </TableRow>
                 ) : (
                   entries.map((entry, idx) => (
                     <TableRow key={entry.product_id}>
                       <TableCell className="font-mono">{entry.code}</TableCell>
                       <TableCell className="font-medium">{entry.name}</TableCell>
                       <TableCell className="text-right">
                         <Input
                           type="number"
                           step="0.01"
                           min="0"
                           className="w-28 text-right ml-auto"
                           value={entry.quantity_produced}
                           onChange={(e) => updateEntry(idx, e.target.value)}
                           placeholder="0"
                         />
                       </TableCell>
                       <TableCell>{entry.unit}</TableCell>
                     </TableRow>
                   ))
                 )}
               </TableBody>
             </Table>
           </CardContent>
         </Card>
       </div>
     </ERPLayout>
   );
 }