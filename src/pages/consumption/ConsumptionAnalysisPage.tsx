 import { useState } from "react";
 import { PageHeader } from "@/components/shared/PageHeader";
 import { ERPLayout } from "@/components/layout/ERPLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { CalendarIcon } from "lucide-react";
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
 import { Calendar } from "@/components/ui/calendar";
 import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
 import { cn } from "@/lib/utils";
 import { Badge } from "@/components/ui/badge";
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
 
 export default function ConsumptionAnalysisPage() {
   const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
   const [selectedDate, setSelectedDate] = useState<Date>(new Date());
   const [isCalendarOpen, setIsCalendarOpen] = useState(false);
 
   const getDateRange = () => {
     switch (period) {
       case "daily":
         return { start: selectedDate, end: selectedDate };
       case "weekly":
         return { start: startOfWeek(selectedDate, { weekStartsOn: 1 }), end: endOfWeek(selectedDate, { weekStartsOn: 1 }) };
       case "monthly":
         return { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) };
     }
   };
 
   const { start, end } = getDateRange();
   const startStr = format(start, "yyyy-MM-dd");
   const endStr = format(end, "yyyy-MM-dd");
 
   // Fetch production data
   const { data: productionData } = useQuery({
     queryKey: ["consumption-analysis-production", startStr, endStr],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("consumption_production_entry")
         .select(`
           product_id,
           quantity_produced,
           entry_date
         `)
         .gte("entry_date", startStr)
         .lte("entry_date", endStr);
       if (error) throw error;
       return data;
     },
   });
 
    // Fetch BOM data
    const { data: bomData } = useQuery({
      queryKey: ["consumption-analysis-bom"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("consumption_bom")
          .select(`
            product_id,
            raw_material_id,
            standard_quantity,
            raw_material:consumption_raw_materials(code, name, unit, priority)
          `)
          .eq("is_active", true);
        if (error) throw error;
        return data;
      },
    });
 
   // Fetch actual consumption
   const { data: closingData } = useQuery({
     queryKey: ["consumption-analysis-closing", startStr, endStr],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("consumption_stock_closing")
         .select(`
           raw_material_id,
           actual_consumption,
           closing_date,
            raw_material:consumption_raw_materials(code, name, unit, priority)
          `)
          .gte("closing_date", startStr)
          .lte("closing_date", endStr);
       if (error) throw error;
       return data;
     },
   });
 
   // Calculate analysis data
   const analysisData = (() => {
     if (!productionData || !bomData || !closingData) return [];
 
     // Calculate standard consumption based on production
      const standardByMaterial: Record<string, { code: string; name: string; unit: string; priority: string; standard: number }> = {};
      productionData.forEach((prod: any) => {
        const bomItems = bomData.filter((b: any) => b.product_id === prod.product_id);
        bomItems.forEach((b: any) => {
          const id = b.raw_material_id;
          if (!standardByMaterial[id]) {
            standardByMaterial[id] = {
              code: b.raw_material?.code || "",
              name: b.raw_material?.name || "Unknown",
              unit: b.raw_material?.unit || "kg",
              priority: b.raw_material?.priority || "medium",
              standard: 0,
            };
          }
         standardByMaterial[id].standard += Number(b.standard_quantity) * Number(prod.quantity_produced);
       });
     });
 
     // Calculate actual consumption
     const actualByMaterial: Record<string, number> = {};
     closingData.forEach((c: any) => {
       actualByMaterial[c.raw_material_id] = (actualByMaterial[c.raw_material_id] || 0) + Number(c.actual_consumption);
     });
 
     // Combine results
     const allMaterialIds = new Set([...Object.keys(standardByMaterial), ...Object.keys(actualByMaterial)]);
     const results: any[] = [];
 
     allMaterialIds.forEach((id) => {
       const standardData = standardByMaterial[id];
       const actual = actualByMaterial[id] || 0;
       const standard = standardData?.standard || 0;
       
       // Get material info from closing data if not in BOM
        let materialInfo = standardData || { code: "", name: "", unit: "kg", priority: "medium" };
        if (!standardData) {
          const closingItem = closingData.find((c: any) => c.raw_material_id === id);
          if (closingItem?.raw_material) {
            materialInfo = {
              code: closingItem.raw_material.code,
              name: closingItem.raw_material.name,
              unit: closingItem.raw_material.unit,
              priority: closingItem.raw_material.priority || "medium",
              standard: 0,
            };
          }
        }
 
       const variance = actual - standard;
       const variancePct = standard > 0 ? (variance / standard) * 100 : actual > 0 ? 100 : 0;
 
        results.push({
          id,
          code: materialInfo.code,
          name: materialInfo.name,
          unit: materialInfo.unit,
          priority: materialInfo.priority,
         standard,
         actual,
         variance,
         variancePct,
         loss: variance > 0 ? variance : 0,
       });
     });
 
     return results.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
   })();
 
   const totalStandard = analysisData.reduce((sum, item) => sum + item.standard, 0);
   const totalActual = analysisData.reduce((sum, item) => sum + item.actual, 0);
   const totalLoss = analysisData.reduce((sum, item) => sum + item.loss, 0);
 
   return (
     <ERPLayout>
       <div className="space-y-6">
         <div className="page-header">
           <div>
             <h1 className="page-title">Consumption Analysis</h1>
             <p className="page-description">Compare actual vs standard consumption and analyze material loss</p>
           </div>
           <div className="flex gap-2 items-center">
               <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                 <SelectTrigger className="w-[120px]">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="daily">Daily</SelectItem>
                   <SelectItem value="weekly">Weekly</SelectItem>
                   <SelectItem value="monthly">Monthly</SelectItem>
                 </SelectContent>
               </Select>
               <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                 <PopoverTrigger asChild>
                   <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                     <CalendarIcon className="mr-2 h-4 w-4" />
                     {period === "daily"
                       ? format(selectedDate, "PPP")
                       : period === "weekly"
                       ? `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`
                       : format(selectedDate, "MMMM yyyy")}
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
             </div>
         </div>
 
         <div className="grid gap-4 md:grid-cols-3">
           <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium text-muted-foreground">Standard Consumption</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{totalStandard.toFixed(2)} kg</div>
               <p className="text-xs text-muted-foreground">Based on BOM × Production</p>
             </CardContent>
           </Card>
           <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium text-muted-foreground">Actual Consumption</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{totalActual.toFixed(2)} kg</div>
               <p className="text-xs text-muted-foreground">Opening + Receipt - Closing</p>
             </CardContent>
           </Card>
           <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium text-muted-foreground">Material Loss</CardTitle>
             </CardHeader>
             <CardContent>
               <div className={cn("text-2xl font-bold", totalLoss > 0 ? "text-destructive" : "text-primary")}>
                 {totalLoss > 0 ? "+" : ""}{totalLoss.toFixed(2)} kg
               </div>
               <p className="text-xs text-muted-foreground">
                 {totalStandard > 0 ? `${((totalLoss / totalStandard) * 100).toFixed(1)}% of standard` : "N/A"}
               </p>
             </CardContent>
           </Card>
         </div>
 
         <Card>
           <CardHeader>
             <CardTitle>Material-wise Analysis</CardTitle>
           </CardHeader>
           <CardContent>
             <Table>
               <TableHeader>
                 <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="text-right">Standard</TableHead>
                   <TableHead className="text-right">Actual</TableHead>
                   <TableHead className="text-right">Variance</TableHead>
                   <TableHead className="text-right">Variance %</TableHead>
                   <TableHead>Status</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {analysisData.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={8} className="text-center text-muted-foreground">
                       No data for this period. Ensure production entries and stock closing are recorded.
                     </TableCell>
                   </TableRow>
                 ) : (
                   analysisData.map((item) => (
                     <TableRow key={item.id}>
                        <TableCell className="font-mono">{item.code}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant={item.priority === "high" ? "destructive" : item.priority === "low" ? "outline" : "secondary"}>
                            {(item.priority || "medium").charAt(0).toUpperCase() + (item.priority || "medium").slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{item.standard.toFixed(2)} {item.unit}</TableCell>
                       <TableCell className="text-right">{item.actual.toFixed(2)} {item.unit}</TableCell>
                       <TableCell className="text-right">
                         <span className={item.variance > 0 ? "text-destructive" : item.variance < 0 ? "text-green-600" : ""}>
                           {item.variance > 0 ? "+" : ""}{item.variance.toFixed(2)} {item.unit}
                         </span>
                       </TableCell>
                       <TableCell className="text-right">
                         <span className={Math.abs(item.variancePct) > 10 ? "text-destructive font-semibold" : ""}>
                           {item.variancePct > 0 ? "+" : ""}{item.variancePct.toFixed(1)}%
                         </span>
                       </TableCell>
                       <TableCell>
                         {Math.abs(item.variancePct) > 10 ? (
                           <Badge variant="destructive">High</Badge>
                         ) : Math.abs(item.variancePct) > 5 ? (
                           <Badge variant="secondary">Moderate</Badge>
                         ) : (
                           <Badge variant="outline">Normal</Badge>
                         )}
                       </TableCell>
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