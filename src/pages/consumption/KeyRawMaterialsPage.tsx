import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, BarChart3, CalendarIcon, Printer, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MultiSearchableSelect } from "@/components/shared/MultiSearchableSelect";
import { supabase } from "@/integrations/supabase/client";
import { useKeyRawMaterials } from "@/hooks/useKeyRawMaterials";
import { materialValueCategoryCode } from "@/lib/materialValueCategory";
import { shareOrDownloadPdf } from "@/lib/sharePdf";
import { cn } from "@/lib/utils";
import {
  MultiMaterialSingleDayView,
  buildMultiMaterialPdf,
  multiMaterialShareSummary,
  printMultiMaterialReport,
  useMultiMaterialSingleDayReport,
} from "./MultiMaterialSingleDayReport";

export default function KeyRawMaterialsPage() {
  const navigate = useNavigate();
  const { keyIds, isLoading: keyLoading, canEdit, saveKeyIds, isSaving } = useKeyRawMaterials();

  // Super admins edit a draft and save it in one go; everyone else sees the saved list.
  const [draftIds, setDraftIds] = useState<string[]>([]);
  useEffect(() => { setDraftIds(keyIds); }, [keyIds]);
  const isDirty = draftIds.length !== keyIds.length || draftIds.some((id, i) => keyIds[i] !== id);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [hideInactive, setHideInactive] = useState(false);
  const [includeBomInPrint, setIncludeBomInPrint] = useState(true);
  const [sharing, setSharing] = useState(false);

  const { data: materials } = useQuery({
    queryKey: ["consumption-report-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit, value_category")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: productsData } = useQuery({
    queryKey: ["consumption-products-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_products")
        .select("id, name, code, production_department_id");
      if (error) throw error;
      return data;
    },
  });

  const { data: departmentsData } = useQuery({
    queryKey: ["consumption-departments-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, sequence_order")
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const productLookup = useMemo(() => {
    const map: Record<string, string> = {};
    productsData?.forEach((p) => { map[p.id] = p.name || p.code; });
    return map;
  }, [productsData]);

  const productDepartmentLookup = useMemo(() => {
    const map: Record<string, string | null> = {};
    productsData?.forEach((p) => { map[p.id] = p.production_department_id ?? null; });
    return map;
  }, [productsData]);

  const departmentNameLookup = useMemo(() => {
    const map: Record<string, string> = {};
    departmentsData?.forEach((d) => { map[d.id] = d.name; });
    return map;
  }, [departmentsData]);

  const materialById = useMemo(() => new Map((materials || []).map((m) => [m.id, m])), [materials]);
  // Inactive materials drop out of every report, so they are hidden here too.
  const visibleDraft = draftIds.filter((id) => materialById.has(id));

  const report = useMultiMaterialSingleDayReport({
    materialIds: keyIds,
    materials,
    date: selectedDate,
    productLookup,
    productDepartmentLookup,
    departmentNameLookup,
    hideInactive,
  });

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= visibleDraft.length) return;
    const next = [...visibleDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraftIds(next);
  };

  const handleSave = async () => {
    try {
      await saveKeyIds(visibleDraft);
      toast.success("Key raw materials saved");
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Failed to save key raw materials");
    }
  };

  const handleShareWhatsApp = async () => {
    if (report.rows.length === 0) return;
    try {
      setSharing(true);
      const pdf = buildMultiMaterialPdf(report, selectedDate, "Key raw materials", includeBomInPrint);
      const result = await shareOrDownloadPdf({
        blob: pdf.blob,
        fileName: pdf.fileName,
        title: `Key Raw Materials - ${format(selectedDate, "dd MMM yyyy")}`,
        text: multiMaterialShareSummary(report, selectedDate),
      });
      if (result === "downloaded") {
        toast.message("Report PDF downloaded", {
          description: "Attach the downloaded PDF to your WhatsApp chat.",
        });
      }
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Failed to share report");
    } finally {
      setSharing(false);
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Key Raw Materials</h1>
            <p className="page-description">
              The materials checked every day — one shared list used by the Material Usage Report's Single Day view
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/consumption/usage-report?view=single&key=1")} disabled={keyIds.length === 0}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Open in Usage Report
            </Button>
            {report.rows.length > 0 && (
              <>
                <Button
                  variant="outline"
                  className="border-green-600 text-green-600 hover:bg-green-50 hover:text-green-700"
                  onClick={handleShareWhatsApp}
                  disabled={sharing}
                >
                  {sharing ? "Preparing…" : "Share PDF via WhatsApp"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => printMultiMaterialReport(report, selectedDate, "Key raw materials", includeBomInPrint)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Report
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Key list */}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" />
              Key List
              <Badge variant="secondary">{canEdit ? visibleDraft.length : keyIds.filter((id) => materialById.has(id)).length}</Badge>
            </CardTitle>
            {canEdit ? (
              <div className="flex gap-2">
                <Button variant="outline" disabled={!isDirty || isSaving} onClick={() => setDraftIds(keyIds)}>
                  Discard
                </Button>
                <Button disabled={!isDirty || isSaving} onClick={handleSave}>
                  {isSaving ? "Saving…" : "Save List"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Only a super admin can change this list.</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {canEdit && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Add or remove materials</label>
                <MultiSearchableSelect
                  values={visibleDraft}
                  onValuesChange={setDraftIds}
                  options={(materials || []).map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))}
                  placeholder="Search and tick raw materials…"
                  emptyText="No materials match."
                  maxChips={6}
                />
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Value Tier</TableHead>
                  {canEdit && <TableHead className="w-32 text-right">Order / Remove</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {keyLoading ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                ) : (canEdit ? visibleDraft : keyIds.filter((id) => materialById.has(id))).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground py-8">
                      {canEdit ? "No key materials yet — add them with the picker above." : "No key materials have been set yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  (canEdit ? visibleDraft : keyIds.filter((id) => materialById.has(id))).map((id, i, list) => {
                    const m = materialById.get(id)!;
                    return (
                      <TableRow key={id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{m.code}</TableCell>
                        <TableCell>{m.name}</TableCell>
                        <TableCell className="text-muted-foreground">{m.unit || "kg"}</TableCell>
                        <TableCell>
                          {m.value_category ? <Badge variant="outline">{materialValueCategoryCode(m.value_category)}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <div className="inline-flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => setDraftIds(visibleDraft.filter((x) => x !== id))}
                                aria-label="Remove"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {canEdit && isDirty && (
              <p className="text-xs text-amber-600">Unsaved changes — the snapshot below still shows the saved list.</p>
            )}
          </CardContent>
        </Card>

        {/* Daily snapshot of the saved list */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-lg font-semibold">Daily Snapshot</h2>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Date</label>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, "dd MMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) { setSelectedDate(date); setIsCalendarOpen(false); }
                  }}
                  disabled={(date) => date > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {keyIds.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Star className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">No key raw materials yet</p>
              <p className="text-sm mt-1">
                {canEdit ? "Add materials to the key list above and save to see their daily snapshot." : "Ask a super admin to set up the key list."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <MultiMaterialSingleDayView
            report={report}
            date={selectedDate}
            hideInactive={hideInactive}
            onHideInactiveChange={setHideInactive}
            includeBomInPrint={includeBomInPrint}
            onIncludeBomInPrintChange={setIncludeBomInPrint}
          />
        )}
      </div>
    </ERPLayout>
  );
}
