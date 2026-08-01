 import { useState } from "react";
 import { PageHeader } from "@/components/shared/PageHeader";
 import { ERPLayout } from "@/components/layout/ERPLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Save, CalendarIcon, Factory } from "lucide-react";
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
   synced?: boolean;
   locked?: boolean;
 }

// Must match consumption_production_sync_cutover() in the database
// (20260801150000_consumption_production_sync.sql). From this date on, mapped
// products sync from posted production and reject manual entry.
const PRODUCTION_SYNC_CUTOVER = "2026-08-01";

interface FromProductionRow {
  entry_date: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  product_unit: string | null;
  conversion_factor: number | null;
  entry_count: number | null;
  production_quantity_ok: number | null;
  converted_quantity: number | null;
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
        .select("id, code, name, unit, grade_id")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });
 
  // Posted production from the production module, resolved through the
  // grade→product mapping and converted to consumption units. Read-only
  // parallel run: compare against the manual entries to validate the
  // mappings and conversion factors before the auto-sync goes live.
  const { data: fromProduction } = useQuery({
    queryKey: ["consumption-production-from-production", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_consumption_production_from_production")
        .select("*")
        .eq("entry_date", dateStr)
        .order("product_code");
      if (error) throw error;
      return data as FromProductionRow[];
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
            const synced = existing?.synced_from_production ?? false;
            return {
              product_id: prod.id,
              code: prod.code,
              name: prod.name,
              quantity_produced: existing ? String(existing.quantity_produced) : "",
              unit: existing?.unit || prod.unit || "pcs",
              existingId: existing?.id,
              synced,
              // Mapped products sync from posted production from the cutover
              // on — manual entry is rejected by the DB, so don't offer it.
              locked: synced || (!!prod.grade_id && dateStr >= PRODUCTION_SYNC_CUTOVER),
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
       // Locked rows (synced, or mapped to production post-cutover) are
       // maintained by the production sync — never write them.
       const toSave = entries.filter((e) => !e.locked && e.quantity_produced !== "" && parseFloat(e.quantity_produced) > 0);
 
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
 
         {fromProduction && fromProduction.length > 0 && (
           <Card>
             <CardHeader>
               <CardTitle className="flex items-center gap-2 text-base">
                 <Factory className="h-4 w-4" />
                 From Production (posted entries)
               </CardTitle>
               <p className="text-sm text-muted-foreground">
                 Posted production for this date flows into consumption automatically. This is the
                 breakdown behind the synced quantities below — to correct a synced value, fix and
                 repost the entry in the production module.
               </p>
             </CardHeader>
             <CardContent>
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead>Code</TableHead>
                     <TableHead>Product</TableHead>
                     <TableHead className="text-right">Posted Entries</TableHead>
                     <TableHead className="text-right">Production OK Qty</TableHead>
                     <TableHead className="text-right">Factor</TableHead>
                     <TableHead className="text-right">Synced Qty</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {fromProduction.map((row) => (
                     <TableRow key={row.product_id}>
                       <TableCell className="font-mono">{row.product_code}</TableCell>
                       <TableCell className="font-medium">{row.product_name}</TableCell>
                       <TableCell className="text-right">{row.entry_count}</TableCell>
                       <TableCell className="text-right">
                         {Number(row.production_quantity_ok ?? 0).toLocaleString()}
                       </TableCell>
                       <TableCell className="text-right">×{row.conversion_factor}</TableCell>
                       <TableCell className="text-right font-medium">
                         {Number(row.converted_quantity ?? 0).toLocaleString()} {row.product_unit}
                       </TableCell>
                     </TableRow>
                   ))}
                 </TableBody>
               </Table>
             </CardContent>
           </Card>
         )}

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
                       <TableCell className="font-medium">
                         {entry.name}
                         {entry.synced ? (
                           <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                             <Factory className="h-3 w-3" />
                             from production
                           </span>
                         ) : entry.locked ? (
                           <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                             <Factory className="h-3 w-3" />
                             awaiting production post
                           </span>
                         ) : null}
                       </TableCell>
                       <TableCell className="text-right">
                         <Input
                           type="number"
                           step="0.01"
                           min="0"
                           className="w-28 text-right ml-auto"
                           value={entry.quantity_produced}
                           onChange={(e) => updateEntry(idx, e.target.value)}
                           placeholder={entry.locked && !entry.synced ? "—" : "0"}
                           disabled={entry.locked}
                           title={
                             entry.synced
                               ? "Maintained automatically from posted production entries"
                               : entry.locked
                                 ? "This product is linked to production — its quantity appears when production entries are posted for this date"
                                 : undefined
                           }
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