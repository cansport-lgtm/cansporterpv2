import { useState } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { CalendarIcon, FileSpreadsheet, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MAX_RANGE_DAYS = 92;

interface ExportRow {
  target_date: string;
  employee_name: string;
  employee_code: string;
  category: string;
  department_name: string;
  department_id: string;
  process_name: string;
  shift: string;
  target_quantity: number;
  todays_target: number | null;
  actual_quantity: number;
  mph: number;
  remarks: string | null;
  check_in: string | null;
  check_out: string | null;
  employee_id: string;
}

const fmtTime = (t: string | null) => {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
};

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="justify-start gap-2 font-normal">
            <CalendarIcon className="h-4 w-4" />
            {format(value, "dd MMM yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              if (d) {
                onChange(d);
                setOpen(false);
              }
            }}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function DeploymentExcelExportButton({ defaultDate }: { defaultDate?: Date }) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(defaultDate || new Date());
  const [toDate, setToDate] = useState<Date>(defaultDate || new Date());
  const [exporting, setExporting] = useState(false);

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && defaultDate) {
      setFromDate(defaultDate);
      setToDate(defaultDate);
    }
  };

  const handleExport = async () => {
    if (fromDate > toDate) {
      toast.error("From date must be on or before To date");
      return;
    }
    if (differenceInCalendarDays(toDate, fromDate) + 1 > MAX_RANGE_DAYS) {
      toast.error(`Date range too large — maximum ${MAX_RANGE_DAYS} days`);
      return;
    }

    setExporting(true);
    try {
      const fromStr = format(fromDate, "yyyy-MM-dd");
      const toStr = format(toDate, "yyyy-MM-dd");

      const [targetsRes, employeesRes, deptsRes, processesRes, prodRes, mphRes] =
        await Promise.all([
          (supabase.from("labour_productivity_targets") as any)
            .select(
              "target_date, employee_id, department_id, process_id, shift, target_quantity, todays_target, actual_quantity, mph, remarks, check_in, check_out"
            )
            .gte("target_date", fromStr)
            .lte("target_date", toStr)
            .order("target_date")
            .limit(50000),
          supabase.from("labour_employees").select("id, full_name, employee_code, category"),
          supabase.from("production_departments").select("id, name"),
          supabase.from("qa_processes").select("id, name"),
          supabase
            .from("production_entries")
            .select("entry_date, department_id, sub_department_id, target_production, quantity_produced")
            .gte("entry_date", fromStr)
            .lte("entry_date", toStr),
          supabase
            .from("mph_calculating_numbers")
            .select("department_id, sub_department_id, mph_number")
            .eq("is_active", true),
        ]);

      if (targetsRes.error) throw targetsRes.error;

      const empMap = new Map((employeesRes.data || []).map((e: any) => [e.id, e]));
      const deptMap = new Map((deptsRes.data || []).map((d: any) => [d.id, d.name]));
      const procMap = new Map((processesRes.data || []).map((p: any) => [p.id, p.name]));

      const rows: ExportRow[] = (targetsRes.data || []).map((t: any) => {
        const emp: any = empMap.get(t.employee_id);
        const deptId = t.department_id || "";
        return {
          target_date: t.target_date,
          employee_id: t.employee_id,
          employee_name: emp?.full_name || "Unknown",
          employee_code: emp?.employee_code || "",
          category: emp?.category || "-",
          department_name: deptMap.get(deptId) || "Unassigned",
          department_id: deptId,
          process_name: procMap.get(t.process_id) || "-",
          shift: t.shift || "-",
          target_quantity: t.target_quantity || 0,
          todays_target: t.todays_target,
          actual_quantity: t.actual_quantity || 0,
          mph: t.mph || 0,
          remarks: t.remarks,
          check_in: t.check_in ?? null,
          check_out: t.check_out ?? null,
        };
      });

      if (rows.length === 0) {
        toast.info(`No deployment entries found between ${format(fromDate, "dd MMM yyyy")} and ${format(toDate, "dd MMM yyyy")}`);
        return;
      }

      // Target/Actual MPH per date+department from production entries
      const mphNumMap = new Map<string, number>();
      (mphRes.data || []).forEach((m: any) => {
        mphNumMap.set(`${m.department_id || ""}-${m.sub_department_id || ""}`, m.mph_number || 0);
      });
      const prodByDateDept: Record<
        string,
        { targetProd: number; produced: number; targetMPH: number; actualMPH: number }
      > = {};
      (prodRes.data || []).forEach((e: any) => {
        const deptId = e.department_id || "";
        const key = `${e.entry_date}|${deptId}`;
        if (!prodByDateDept[key])
          prodByDateDept[key] = { targetProd: 0, produced: 0, targetMPH: 0, actualMPH: 0 };
        const mphNum = mphNumMap.get(`${deptId}-${e.sub_department_id || ""}`) || 0;
        prodByDateDept[key].targetProd += e.target_production || 0;
        prodByDateDept[key].produced += e.quantity_produced || 0;
        prodByDateDept[key].targetMPH += (e.target_production || 0) * mphNum;
        prodByDateDept[key].actualMPH += (e.quantity_produced || 0) * mphNum;
      });

      const XLSX = await import("xlsx");

      // ---- Detail sheet ----
      const detailHeaders = [
        "Date",
        "Department",
        "Employee",
        "Code",
        "Category",
        "Process",
        "Shift",
        "Check In",
        "Check Out",
        "MPH",
        "Std Target",
        "Today's Target",
        "Actual",
        "Efficiency %",
        "Remarks",
      ];
      const detailData = rows
        .slice()
        .sort(
          (a, b) =>
            a.target_date.localeCompare(b.target_date) ||
            a.department_name.localeCompare(b.department_name) ||
            a.employee_name.localeCompare(b.employee_name)
        )
        .map((r) => {
          const tgt = r.todays_target || r.target_quantity;
          const eff = tgt > 0 ? Math.round((r.actual_quantity / tgt) * 100) : null;
          return [
            format(new Date(`${r.target_date}T00:00:00`), "dd MMM yyyy"),
            r.department_name,
            r.employee_name,
            r.employee_code,
            r.category,
            r.process_name,
            r.shift,
            fmtTime(r.check_in),
            fmtTime(r.check_out),
            r.mph,
            r.target_quantity,
            r.todays_target ?? "",
            r.actual_quantity,
            eff ?? "",
            r.remarks || "",
          ];
        });

      // ---- Summary sheet: per date + department ----
      const summaryHeaders = [
        "Date",
        "Department",
        "Workers",
        "MPH Deployed",
        "Target Prod",
        "Production",
        "Target MPH",
        "Actual MPH",
        "Planned L/G",
        "Actual L/G",
        "Std Target",
        "Today's Target",
        "Actual",
        "Efficiency %",
      ];
      const groups = new Map<string, ExportRow[]>();
      rows.forEach((r) => {
        const key = `${r.target_date}|${r.department_name}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      });
      const summaryData = Array.from(groups.keys())
        .sort()
        .map((key) => {
          const items = groups.get(key)!;
          const [dateStr, deptName] = key.split("|");
          const deptId = items[0]?.department_id || "";
          const prod = prodByDateDept[`${dateStr}|${deptId}`];
          const workers = new Set(items.map((i) => i.employee_id).filter(Boolean)).size;
          // Cap each employee's daily MPH at 12, matching on-page calculation
          const mphPerEmp = new Map<string, number>();
          items.forEach((e) => {
            if (!e.employee_id) return;
            mphPerEmp.set(e.employee_id, (mphPerEmp.get(e.employee_id) || 0) + (e.mph || 0));
          });
          let mph = 0;
          mphPerEmp.forEach((v) => { mph += Math.min(12, v); });
          const stdTgt = items.reduce((s, e) => s + e.target_quantity, 0);
          const todayTgt = items.reduce((s, e) => s + (e.todays_target || 0), 0);
          const actual = items.reduce((s, e) => s + e.actual_quantity, 0);
          const targetMPH = Math.round(prod?.targetMPH || 0);
          const actualMPH = Math.round(prod?.actualMPH || 0);
          const denom = todayTgt || stdTgt;
          return [
            format(new Date(`${dateStr}T00:00:00`), "dd MMM yyyy"),
            deptName,
            workers,
            mph,
            prod?.targetProd || 0,
            prod?.produced || 0,
            targetMPH,
            actualMPH,
            mph - targetMPH,
            mph - actualMPH,
            stdTgt,
            todayTgt,
            actual,
            denom > 0 ? Math.round((actual / denom) * 100) : "",
          ];
        });

      const rangeLabel =
        fromStr === toStr
          ? format(fromDate, "dd MMM yyyy")
          : `${format(fromDate, "dd MMM yyyy")} to ${format(toDate, "dd MMM yyyy")}`;

      const wb = XLSX.utils.book_new();

      const summaryWs = XLSX.utils.aoa_to_sheet([
        [`Labour Deployment & Targets Summary — ${rangeLabel}`],
        summaryHeaders,
        ...summaryData,
      ]);
      summaryWs["!cols"] = [
        { wch: 12 }, { wch: 22 }, { wch: 9 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
        { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 14 },
        { wch: 10 }, { wch: 12 },
      ];
      summaryWs["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: summaryHeaders.length - 1 } }];
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

      const detailWs = XLSX.utils.aoa_to_sheet([
        [`Labour Deployment & Targets Detail — ${rangeLabel}`],
        detailHeaders,
        ...detailData,
      ]);
      detailWs["!cols"] = [
        { wch: 12 }, { wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
        { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 6 }, { wch: 10 }, { wch: 14 },
        { wch: 8 }, { wch: 12 }, { wch: 28 },
      ];
      detailWs["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: detailHeaders.length - 1 } }];
      XLSX.utils.book_append_sheet(wb, detailWs, "Detail");

      XLSX.writeFile(wb, `Labour-Deployment-${fromStr}${fromStr === toStr ? "" : `_to_${toStr}`}.xlsx`);
      toast.success(`Exported ${rows.length} entries (${rangeLabel})`);
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Export Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export to Excel</DialogTitle>
          <DialogDescription>
            Select a custom date range to export labour deployment & target data with a
            department-wise summary and full employee detail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <DatePickerField label="From" value={fromDate} onChange={setFromDate} />
          <DatePickerField label="To" value={toDate} onChange={setToDate} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
