import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { QS_ENTRY_SELECT, QsEntry, SHIFT_OPTIONS } from "./qsShared";

interface Lookup { id: string; name: string; }

export interface QsEntryContext {
  date: string;
  setDate: (v: string) => void;
  departmentId: string;
  setDepartmentId: (v: string) => void;
  shift: string;
  setShift: (v: string) => void;
  productId: string; // "none" when not set
  setProductId: (v: string) => void;
  gradeId: string; // "none" when not set
  setGradeId: (v: string) => void;
  ready: boolean;
  entry: QsEntry | null | undefined;
  entryLoading: boolean;
  refetchEntry: () => void;
  entryQueryKey: (string | null)[];
  findOrCreateEntry: () => Promise<string>;
}

// Both inspector entry pages score against the same context: date + department + shift
// (+ optional product/grade). The qs_score_entries row is created lazily on first submit.
export function useQsEntryContext(): QsEntryContext {
  const { user } = useAuth();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [departmentId, setDepartmentId] = useState("");
  const [shift, setShift] = useState("morning");
  const [productId, setProductId] = useState("none");
  const [gradeId, setGradeId] = useState("none");

  const ready = !!date && !!departmentId;
  const entryQueryKey = [
    "qs-entry-context", date, departmentId, shift,
    productId === "none" ? null : productId,
    gradeId === "none" ? null : gradeId,
  ];

  const { data: entry, isLoading: entryLoading, refetch: refetchEntry } = useQuery({
    queryKey: entryQueryKey,
    enabled: ready,
    queryFn: async () => {
      let q = (supabase as any)
        .from("qs_score_entries")
        .select(QS_ENTRY_SELECT)
        .eq("entry_date", date)
        .eq("department_id", departmentId)
        .eq("shift", shift);
      q = productId !== "none" ? q.eq("product_id", productId) : q.is("product_id", null);
      q = gradeId !== "none" ? q.eq("grade_id", gradeId) : q.is("grade_id", null);
      const { data, error } = await q.limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as QsEntry | null;
    },
  });

  const findOrCreateEntry = async (): Promise<string> => {
    if (entry?.id) return entry.id;
    const { data, error } = await (supabase as any)
      .from("qs_score_entries")
      .insert({
        entry_date: date,
        department_id: departmentId,
        shift,
        product_id: productId !== "none" ? productId : null,
        grade_id: gradeId !== "none" ? gradeId : null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };

  return {
    date, setDate, departmentId, setDepartmentId, shift, setShift,
    productId, setProductId, gradeId, setGradeId,
    ready, entry, entryLoading, refetchEntry, entryQueryKey, findOrCreateEntry,
  };
}

export function EntryContextSection({ ctx }: { ctx: QsEntryContext }) {
  const { data: departments = [] } = useQuery({
    queryKey: ["qs-lookup-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as Lookup[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["qs-lookup-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as Lookup[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["qs-lookup-grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as Lookup[];
    },
  });

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={ctx.date} onChange={(e) => ctx.setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={ctx.departmentId} onValueChange={ctx.setDepartmentId}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Shift</Label>
            <Select value={ctx.shift} onValueChange={ctx.setShift}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Product (optional)</Label>
            <Select value={ctx.productId} onValueChange={ctx.setProductId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All / not specified</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Grade (optional)</Label>
            <Select value={ctx.gradeId} onValueChange={ctx.setGradeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All / not specified</SelectItem>
                {grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
