 import { PageHeader } from "@/components/shared/PageHeader";
 import { MetricCard } from "@/components/shared/MetricCard";
 import { ERPLayout } from "@/components/layout/ERPLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Package, TrendingDown, AlertTriangle, BarChart3 } from "lucide-react";
 import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Badge } from "@/components/ui/badge";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 
 export default function ConsumptionDashboard() {
   const today = new Date();
   const weekStart = startOfWeek(today, { weekStartsOn: 1 });
   const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
 
   // Fetch raw materials count
   const { data: rawMaterials } = useQuery({
     queryKey: ["consumption-raw-materials-count"],
     queryFn: async () => {
       const { count } = await supabase
         .from("consumption_raw_materials")
         .select("*", { count: "exact", head: true })
         .eq("is_active", true);
       return count || 0;
     },
   });
 
   // Fetch BOM count
   const { data: bomCount } = useQuery({
     queryKey: ["consumption-bom-count"],
     queryFn: async () => {
       const { count } = await supabase
         .from("consumption_bom")
         .select("*", { count: "exact", head: true })
         .eq("is_active", true);
       return count || 0;
     },
   });
 
   // Fetch today's stock closing
   const { data: todayClosing } = useQuery({
     queryKey: ["consumption-today-closing"],
     queryFn: async () => {
       const { data } = await supabase
         .from("consumption_stock_closing")
         .select(`
           *,
           raw_material:consumption_raw_materials(name, unit)
         `)
         .eq("closing_date", format(today, "yyyy-MM-dd"));
       return data || [];
     },
   });
 
   // Fetch weekly consumption summary
   const { data: weeklyConsumption } = useQuery({
     queryKey: ["consumption-weekly-summary", format(weekStart, "yyyy-MM-dd")],
     queryFn: async () => {
       const { data } = await supabase
         .from("consumption_stock_closing")
         .select(`
           raw_material_id,
           actual_consumption,
           raw_material:consumption_raw_materials(name, unit)
         `)
         .gte("closing_date", format(weekStart, "yyyy-MM-dd"))
         .lte("closing_date", format(weekEnd, "yyyy-MM-dd"));
       
       // Group by material
       const grouped: Record<string, { name: string; unit: string; total: number }> = {};
       data?.forEach((item: any) => {
         const id = item.raw_material_id;
         if (!grouped[id]) {
           grouped[id] = {
             name: item.raw_material?.name || "Unknown",
             unit: item.raw_material?.unit || "kg",
             total: 0,
           };
         }
         grouped[id].total += Number(item.actual_consumption) || 0;
       });
       return Object.values(grouped);
     },
   });
 
   // Fetch consumption variance data
   const { data: varianceData } = useQuery({
     queryKey: ["consumption-variance", format(today, "yyyy-MM-dd")],
     queryFn: async () => {
       // Get production entries
       const { data: production } = await supabase
         .from("consumption_production_entry")
         .select(`
           product_id,
           quantity_produced,
           entry_date
         `)
         .gte("entry_date", format(subDays(today, 7), "yyyy-MM-dd"))
         .lte("entry_date", format(today, "yyyy-MM-dd"));
 
       // Get BOM data
       const { data: bom } = await supabase
         .from("consumption_bom")
         .select(`
           product_id,
           raw_material_id,
           standard_quantity,
           raw_material:consumption_raw_materials(name, unit)
         `)
         .eq("is_active", true);
 
       // Calculate standard consumption
       const standardByMaterial: Record<string, { name: string; unit: string; standard: number }> = {};
       production?.forEach((prod: any) => {
         const bomItems = bom?.filter((b: any) => b.product_id === prod.product_id) || [];
         bomItems.forEach((b: any) => {
           const id = b.raw_material_id;
           if (!standardByMaterial[id]) {
             standardByMaterial[id] = {
               name: b.raw_material?.name || "Unknown",
               unit: b.raw_material?.unit || "kg",
               standard: 0,
             };
           }
           standardByMaterial[id].standard += Number(b.standard_quantity) * Number(prod.quantity_produced);
         });
       });
 
       // Get actual consumption
       const { data: closing } = await supabase
         .from("consumption_stock_closing")
         .select("raw_material_id, actual_consumption")
         .gte("closing_date", format(subDays(today, 7), "yyyy-MM-dd"))
         .lte("closing_date", format(today, "yyyy-MM-dd"));
 
       const actualByMaterial: Record<string, number> = {};
       closing?.forEach((c: any) => {
         actualByMaterial[c.raw_material_id] = (actualByMaterial[c.raw_material_id] || 0) + Number(c.actual_consumption);
       });
 
       // Calculate variance
       return Object.entries(standardByMaterial).map(([id, data]) => ({
         name: data.name,
         unit: data.unit,
         standard: data.standard,
         actual: actualByMaterial[id] || 0,
         variance: (actualByMaterial[id] || 0) - data.standard,
         variancePct: data.standard > 0 ? (((actualByMaterial[id] || 0) - data.standard) / data.standard) * 100 : 0,
       }));
     },
   });
 
   const totalActualConsumption = todayClosing?.reduce(
     (sum, item: any) => sum + (Number(item.actual_consumption) || 0),
     0
   ) || 0;
 
   const highVarianceCount = varianceData?.filter((v) => Math.abs(v.variancePct) > 10).length || 0;
 
   return (
     <ERPLayout>
       <div className="space-y-6">
 
         <div className="page-header">
           <div>
             <h1 className="page-title">Material Consumption Dashboard</h1>
             <p className="page-description">Track raw material consumption vs production and analyze material loss</p>
           </div>
         </div>
 
         <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
           <MetricCard
             title="Raw Materials"
             value={rawMaterials || 0}
             icon={Package}
             description="Active materials tracked"
           />
           <MetricCard
             title="BOM Recipes"
             value={bomCount || 0}
             icon={BarChart3}
             description="Active consumption standards"
           />
           <MetricCard
             title="Today's Consumption"
             value={`${totalActualConsumption.toFixed(2)} kg`}
             icon={TrendingDown}
             description="Total actual consumption"
           />
           <MetricCard
             title="High Variance Items"
             value={highVarianceCount}
             icon={AlertTriangle}
             trend={highVarianceCount > 0 ? { value: 10, isPositive: false } : undefined}
             description="Materials with >10% variance"
           />
         </div>
 
         <Tabs defaultValue="variance" className="space-y-4">
           <TabsList>
             <TabsTrigger value="variance">Consumption Variance (7 Days)</TabsTrigger>
             <TabsTrigger value="weekly">Weekly Summary</TabsTrigger>
             <TabsTrigger value="today">Today's Closing</TabsTrigger>
           </TabsList>
 
           <TabsContent value="variance">
             <Card>
               <CardHeader>
                 <CardTitle>Material Consumption Variance Analysis</CardTitle>
               </CardHeader>
               <CardContent>
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Material</TableHead>
                       <TableHead className="text-right">Standard Qty</TableHead>
                       <TableHead className="text-right">Actual Qty</TableHead>
                       <TableHead className="text-right">Variance</TableHead>
                       <TableHead className="text-right">Variance %</TableHead>
                       <TableHead>Status</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {varianceData?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center text-muted-foreground">
                           No variance data available. Add production entries and stock closings.
                         </TableCell>
                       </TableRow>
                     ) : (
                       varianceData?.map((item, idx) => (
                         <TableRow key={idx}>
                           <TableCell className="font-medium">{item.name}</TableCell>
                           <TableCell className="text-right">{item.standard.toFixed(2)} {item.unit}</TableCell>
                           <TableCell className="text-right">{item.actual.toFixed(2)} {item.unit}</TableCell>
                           <TableCell className="text-right">
                             <span className={item.variance > 0 ? "text-destructive" : "text-green-600"}>
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
                               <Badge variant="destructive">High Loss</Badge>
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
           </TabsContent>
 
           <TabsContent value="weekly">
             <Card>
               <CardHeader>
                 <CardTitle>Weekly Consumption Summary ({format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")})</CardTitle>
               </CardHeader>
               <CardContent>
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Material</TableHead>
                       <TableHead className="text-right">Total Consumption</TableHead>
                       <TableHead>Unit</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {weeklyConsumption?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={3} className="text-center text-muted-foreground">
                           No consumption data for this week
                         </TableCell>
                       </TableRow>
                     ) : (
                       weeklyConsumption?.map((item, idx) => (
                         <TableRow key={idx}>
                           <TableCell className="font-medium">{item.name}</TableCell>
                           <TableCell className="text-right">{item.total.toFixed(2)}</TableCell>
                           <TableCell>{item.unit}</TableCell>
                         </TableRow>
                       ))
                     )}
                   </TableBody>
                 </Table>
               </CardContent>
             </Card>
           </TabsContent>
 
           <TabsContent value="today">
             <Card>
               <CardHeader>
                 <CardTitle>Today's Stock Closing ({format(today, "MMM d, yyyy")})</CardTitle>
               </CardHeader>
               <CardContent>
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead>Material</TableHead>
                       <TableHead className="text-right">Opening</TableHead>
                       <TableHead className="text-right">Receipts</TableHead>
                       <TableHead className="text-right">Closing</TableHead>
                       <TableHead className="text-right">Consumption</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {todayClosing?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={5} className="text-center text-muted-foreground">
                           No closing entries for today
                         </TableCell>
                       </TableRow>
                     ) : (
                       todayClosing?.map((item: any) => (
                         <TableRow key={item.id}>
                           <TableCell className="font-medium">{item.raw_material?.name}</TableCell>
                           <TableCell className="text-right">{Number(item.opening_quantity).toFixed(2)} {item.raw_material?.unit}</TableCell>
                           <TableCell className="text-right">{Number(item.receipt_quantity).toFixed(2)} {item.raw_material?.unit}</TableCell>
                           <TableCell className="text-right">{Number(item.closing_quantity).toFixed(2)} {item.raw_material?.unit}</TableCell>
                           <TableCell className="text-right font-semibold">{Number(item.actual_consumption).toFixed(2)} {item.raw_material?.unit}</TableCell>
                         </TableRow>
                       ))
                     )}
                   </TableBody>
                 </Table>
               </CardContent>
             </Card>
           </TabsContent>
         </Tabs>
       </div>
     </ERPLayout>
   );
 }