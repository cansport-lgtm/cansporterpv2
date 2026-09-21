import { useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, Info, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MATERIAL_VALUE_CATEGORIES,
  materialValueCategoryCode,
  type MaterialValueCategory,
} from "@/lib/materialValueCategory";

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  description: string | null;
  priority: string | null;
  is_active: boolean;
  cost_value: number | null;
  threshold: number | null;
  closing_frequency: string | null;
  value_category: MaterialValueCategory | null;
}

/**
 * Raw Materials (read-only).
 *
 * Raw materials are maintained centrally in Master Data -> Items
 * (category = raw_material). Each raw-material item is mirrored into
 * consumption_raw_materials and kept in sync automatically (DB trigger), so the
 * consumption module's BOM, stock-closing and reports all use the same master.
 * This page is a read-only view of that synced list — add or edit materials in
 * the Items master.
 */
export default function RawMaterialsPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [valueCategoryFilter, setValueCategoryFilter] = useState<MaterialValueCategory | "all">("all");

  const { data: materials, isLoading } = useQuery({
    queryKey: ["consumption-raw-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as RawMaterial[];
    },
  });

  // Map RM id -> linked procurement item (set on the Items master).
  const { data: linkedItemByRmId = {} } = useQuery({
    queryKey: ["consumption-rm-linked-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, code, name, consumption_raw_material_id")
        .not("consumption_raw_material_id", "is", null);
      if (error) throw error;
      const map: Record<string, { id: string; code: string; name: string }> = {};
      (data || []).forEach((row: any) => {
        if (row.consumption_raw_material_id) {
          map[row.consumption_raw_material_id] = { id: row.id, code: row.code, name: row.name };
        }
      });
      return map;
    },
  });

  // Client-side search across code, name, category and the linked item —
  // the full list is already loaded, so filtering as you type is instant.
  const filteredMaterials = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return materials?.filter((material) => {
      if (valueCategoryFilter !== "all" && material.value_category !== valueCategoryFilter) {
        return false;
      }
      if (!needle) return true;
      const linked = linkedItemByRmId[material.id];
      const haystack = [
        material.code,
        material.name,
        material.category || "",
        linked ? `${linked.code} ${linked.name}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [materials, linkedItemByRmId, searchTerm, valueCategoryFilter]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Raw Materials</h1>
            <p className="page-description">Raw materials used for consumption — managed in the Items master</p>
          </div>
          <Button onClick={() => navigate("/master/items")}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Manage in Items Master
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Raw materials are maintained centrally in <strong>Master Data → Items</strong> (category “Raw Material”).
            This list mirrors those items and updates automatically, so the BOM, stock closing and reports always use
            the same raw materials. Add or edit materials — including their raw-material category — in the Items master.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by code, name, category or linked item…"
              className="pl-9"
            />
          </div>
          <Select
            value={valueCategoryFilter}
            onValueChange={(value) => setValueCategoryFilter(value as MaterialValueCategory | "all")}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Value tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All value tiers</SelectItem>
              {MATERIAL_VALUE_CATEGORIES.map((tier) => (
                <SelectItem key={tier.value} value={tier.value}>
                  {tier.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Value Tier</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead>Linked Item</TableHead>
                    <TableHead>Closing</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center">Loading...</TableCell>
                    </TableRow>
                  ) : filteredMaterials?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground">
                        {searchTerm
                          ? `No raw materials match “${searchTerm}”.`
                          : "No raw materials found. Add raw-material items in the Items master."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMaterials?.map((material) => (
                      <TableRow key={material.id}>
                        <TableCell className="font-mono">{material.code}</TableCell>
                        <TableCell className="font-medium">{material.name}</TableCell>
                        <TableCell>{material.unit}</TableCell>
                        <TableCell>{material.category || "-"}</TableCell>
                        <TableCell>
                          {material.value_category ? (
                            <Badge variant="outline">{materialValueCategoryCode(material.value_category)}</Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-right">{(material.cost_value || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-xs">
                          {linkedItemByRmId[material.id]
                            ? `${linkedItemByRmId[material.id].code} · ${linkedItemByRmId[material.id].name}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={material.closing_frequency === "weekly" ? "outline" : "secondary"}>
                            {material.closing_frequency === "weekly" ? "Weekly" : "Daily"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={material.priority === "high" ? "destructive" : material.priority === "low" ? "outline" : "secondary"}>
                            {(material.priority || "medium").charAt(0).toUpperCase() + (material.priority || "medium").slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={material.is_active ? "default" : "secondary"}>
                            {material.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground">Loading...</div>
              ) : filteredMaterials?.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  {searchTerm ? `No raw materials match “${searchTerm}”.` : "No raw materials found."}
                </div>
              ) : (
                filteredMaterials?.map((material) => (
                  <div key={material.id} className="p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{material.name}</span>
                      <Badge variant={material.is_active ? "default" : "secondary"} className="text-xs shrink-0">
                        {material.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-mono">{material.code}</span>
                      <span>{material.unit}</span>
                      {material.category && <span>{material.category}</span>}
                      <span>₹{(material.cost_value || 0).toFixed(2)}</span>
                      {linkedItemByRmId[material.id] && (
                        <span>↔ {linkedItemByRmId[material.id].code}</span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant={material.priority === "high" ? "destructive" : material.priority === "low" ? "outline" : "secondary"} className="text-xs">
                        {(material.priority || "medium").charAt(0).toUpperCase() + (material.priority || "medium").slice(1)}
                      </Badge>
                      <Badge variant={material.closing_frequency === "weekly" ? "outline" : "secondary"} className="text-xs">
                        {material.closing_frequency === "weekly" ? "Weekly closing" : "Daily closing"}
                      </Badge>
                      {material.value_category && (
                        <Badge variant="outline" className="text-xs">
                          {materialValueCategoryCode(material.value_category)}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
