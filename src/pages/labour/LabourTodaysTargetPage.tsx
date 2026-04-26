import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Target, Users, TrendingUp, ChevronDown, ChevronRight, Clock, Factory, ArrowUpDown, Printer, ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Badge } from "@/components/ui/badge";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";

interface TargetEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  employee_photo: string | null;
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
}

const fmtTime = (t: string | null) => {
  if (!t) return "-";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
};

export default function LabourTodaysTargetPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["todays-target", dateStr],
    queryFn: async () => {
      const targetsRes = await (supabase.from("labour_productivity_targets") as any).select("id, employee_id, department_id, process_id, shift, target_quantity, todays_target, actual_quantity, mph, remarks, check_in, check_out").eq("target_date", dateStr).limit(5000);
      const employeesRes = await supabase.from("labour_employees").select("id, full_name, employee_code, photo_url, category").eq("is_active", true);
      const deptsRes = await supabase.from("production_departments").select("id, name");
      const processesRes = await supabase.from("qa_processes").select("id, name");

      const empMap = new Map((employeesRes.data || []).map(e => [e.id, e]));
      const deptMap = new Map((deptsRes.data || []).map(d => [d.id, d.name]));
      const procMap = new Map((processesRes.data || []).map(p => [p.id, p.name]));

      return (targetsRes.data || []).map((t: any): TargetEntry => {
        const emp: any = empMap.get(t.employee_id);
        const deptId = t.department_id || "";
        return {
          id: t.id,
          employee_id: t.employee_id,
          employee_name: emp?.full_name || "Unknown",
          employee_code: emp?.employee_code || "",
          employee_photo: emp?.photo_url || null,
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
    },
  });

  // Fetch production entries for target production
  const { data: prodData = {} } = useQuery({
    queryKey: ["todays-target-production", dateStr],
    queryFn: async () => {
      const res = await supabase.from("production_entries").select("department_id, sub_department_id, target_production, quantity_produced").eq("entry_date", dateStr);
      const map: Record<string, { targetProd: number; produced: number }> = {};
      (res.data || []).forEach((r) => {
        const deptId = r.department_id || "";
        if (!map[deptId]) map[deptId] = { targetProd: 0, produced: 0 };
        map[deptId].targetProd += r.target_production || 0;
        map[deptId].produced += r.quantity_produced || 0;
      });
      return map;
    },
  });

  // Fetch MPH calculating numbers
  const { data: mphNumbers = [] } = useQuery({
    queryKey: ["mph-calculating-numbers"],
    queryFn: async () => {
      const res = await supabase.from("mph_calculating_numbers").select("department_id, sub_department_id, mph_number").eq("is_active", true);
      return res.data || [];
    },
  });

  // Fetch production entries with sub_department for Target MPH calculation
  const { data: prodEntriesRaw = [] } = useQuery({
    queryKey: ["todays-target-prod-entries", dateStr],
    queryFn: async () => {
      const res = await supabase.from("production_entries").select("department_id, sub_department_id, target_production").eq("entry_date", dateStr);
      return res.data || [];
    },
  });

  // Calculate Target MPH per department: sum(target_production × mph_number) grouped by dept
  const targetMPHByDept = (() => {
    const mphMap = new Map<string, number>();
    mphNumbers.forEach((m: any) => {
      const key = `${m.department_id || ""}-${m.sub_department_id || ""}`;
      mphMap.set(key, m.mph_number || 0);
    });
    const deptMap: Record<string, number> = {};
    prodEntriesRaw.forEach((e: any) => {
      const deptId = e.department_id || "";
      const key = `${deptId}-${e.sub_department_id || ""}`;
      const mphNum = mphMap.get(key) || 0;
      const val = (e.target_production || 0) * mphNum;
      deptMap[deptId] = (deptMap[deptId] || 0) + val;
    });
    return deptMap;
  })();

  // Group by department
  const grouped = (entries as TargetEntry[]).reduce<Record<string, TargetEntry[]>>((acc, e) => {
    const key = e.department_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  const sortedDepts = Object.keys(grouped).sort();

  const totalWorkers = new Set((entries as TargetEntry[]).map(e => e.employee_id).filter(Boolean)).size;
  const totalStdTarget = entries.reduce((s, e) => s + e.target_quantity, 0);
  const totalTodaysTarget = entries.reduce((s, e) => s + (e.todays_target || 0), 0);
  const totalActual = entries.reduce((s, e) => s + e.actual_quantity, 0);
  const totalMPH = entries.reduce((s, e) => s + e.mph, 0);
  const overallEff = totalTodaysTarget > 0 ? Math.round((totalActual / totalTodaysTarget) * 100) : totalStdTarget > 0 ? Math.round((totalActual / totalStdTarget) * 100) : 0;
  const totalTargetProd = Object.values(prodData as Record<string, { targetProd: number; produced: number }>).reduce((s, d) => s + d.targetProd, 0);
  const totalTargetMPH = Object.values(targetMPHByDept).reduce((s, v) => s + v, 0);
  const totalPlannedLG = totalMPH - Math.round(totalTargetMPH);
  const lgColor = totalPlannedLG > 0 ? "text-red-600" : totalPlannedLG < 0 ? "text-green-600" : "text-muted-foreground";

  const toggleDept = (dept: string) => setOpenDepts(p => ({ ...p, [dept]: !p[dept] }));

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    // Show immediate feedback
    printWindow.document.open();
    printWindow.document.write(
      `<!doctype html><html><head><title>Preparing print…</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555;font-size:14px}</style></head><body>Preparing print…</body></html>`
    );
    printWindow.document.close();

    // Defer heavy HTML build so the new tab paints first
    setTimeout(() => {
      const dateLabel = format(selectedDate, "dd MMM yyyy");
      const effPct = (a: number, t: number) => (t > 0 ? Math.round((a / t) * 100) : 0);
      const effColor = (eff: number, hasTarget: boolean) => {
        if (!hasTarget) return "#6b7280";
        if (eff >= 100) return "#16a34a";
        if (eff >= 80) return "#ca8a04";
        return "#dc2626";
      };

      const deptSections = sortedDepts
        .map((dept) => {
          const items = grouped[dept];
          if (!items || items.length === 0) return "";
          let deptStd = 0, deptToday = 0, deptActual = 0, deptMPH = 0;
          for (const e of items) {
            deptStd += e.target_quantity;
            deptToday += e.todays_target || 0;
            deptActual += e.actual_quantity;
            deptMPH += e.mph;
          }
          const deptId = items[0]?.department_id || "";
          const deptProd = (prodData as Record<string, { targetProd: number; produced: number }>)[deptId];
          const deptTargetProd = deptProd?.targetProd || 0;
          const deptTargetMPH = Math.round(targetMPHByDept[deptId] || 0);
          const deptLG = deptMPH - deptTargetMPH;
          const deptLGColor = deptLG > 0 ? "#dc2626" : deptLG < 0 ? "#16a34a" : "#6b7280";
          const deptEff = effPct(deptActual, deptToday || deptStd);
          const deptEffColor = effColor(deptEff, (deptToday || deptStd) > 0);

          const rows = items
            .map((e) => {
              const tgt = e.todays_target || e.target_quantity;
              const hasTgt = tgt > 0;
              const eff = effPct(e.actual_quantity, tgt);
              return `<tr><td>${e.employee_name}</td><td>${e.employee_code}</td><td>${e.category}</td><td>${e.process_name}</td><td>${e.shift}</td><td>${fmtTime(e.check_in)}</td><td>${fmtTime(e.check_out)}</td><td style="text-align:right">${e.mph}</td><td style="text-align:right">${e.target_quantity}</td><td style="text-align:right">${e.todays_target ?? "-"}</td><td style="text-align:right">${e.actual_quantity}</td><td style="text-align:center;color:${effColor(eff, hasTgt)};font-weight:600">${hasTgt ? eff + "%" : "-"}</td><td>${e.remarks || "-"}</td></tr>`;
            })
            .join("");

          return `<div class="dept-section"><div class="dept-header"><div class="dept-title">${dept} <span class="badge">${items.length} workers</span></div><div class="dept-summary"><span>MPH: <strong style="color:#2563eb">${deptMPH}</strong></span><span>Target Prod: <strong style="color:#ea580c">${deptTargetProd.toLocaleString()}</strong></span><span>Target MPH: <strong style="color:#7c3aed">${deptTargetMPH.toLocaleString()}</strong></span><span>P. L/G: <strong style="color:${deptLGColor}">${deptLG}</strong></span><span>Std: <strong>${deptStd}</strong></span><span>Today: <strong>${deptToday}</strong></span><span>Actual: <strong>${deptActual}</strong></span><span>Eff: <strong style="color:${deptEffColor}">${(deptToday || deptStd) > 0 ? deptEff + "%" : "-"}</strong></span></div></div><table><thead><tr><th>Employee</th><th>Code</th><th>Category</th><th>Process</th><th>Shift</th><th>Check In</th><th>Check Out</th><th style="text-align:right">MPH</th><th style="text-align:right">Std Tgt</th><th style="text-align:right">Today's Tgt</th><th style="text-align:right">Actual</th><th style="text-align:center">Eff%</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        })
        .join("");

      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Today's Deployment & Targets - ${dateLabel}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:12px}h1{font-size:18px;margin:0 0 4px}.meta{font-size:11px;color:#555;margin-bottom:10px}.summary{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin-bottom:14px}.kpi{border:1px solid #d1d5db;border-radius:4px;padding:6px 8px}.kpi .lbl{font-size:9px;color:#6b7280;text-transform:uppercase}.kpi .val{font-size:14px;font-weight:700}.dept-section{margin-bottom:14px;page-break-inside:avoid}.dept-header{background:#f3f4f6;padding:6px 8px;border:1px solid #d1d5db;border-bottom:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}.dept-title{font-size:13px;font-weight:700}.badge{display:inline-block;background:#e5e7eb;color:#374151;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:500;margin-left:6px}.dept-summary{font-size:10px;display:flex;gap:10px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #d1d5db;padding:4px 6px}th{background:#f9fafb;font-weight:600;text-align:left}tbody tr:nth-child(even){background:#fafafa}@media print{body{padding:0}}</style></head><body><h1>Today's Labour Deployment & Targets</h1><div class="meta">Date: <strong>${dateLabel}</strong> &nbsp;|&nbsp; Printed: ${format(new Date(), "dd MMM yyyy HH:mm")}</div><div class="summary"><div class="kpi"><div class="lbl">Total Workers</div><div class="val">${totalWorkers}</div></div><div class="kpi"><div class="lbl">Std Target</div><div class="val">${totalStdTarget.toLocaleString()}</div></div><div class="kpi"><div class="lbl">Today's Target</div><div class="val">${totalTodaysTarget.toLocaleString()}</div></div><div class="kpi"><div class="lbl">Actual</div><div class="val">${totalActual.toLocaleString()}</div></div><div class="kpi"><div class="lbl">MPH Deployed</div><div class="val">${totalMPH.toLocaleString()}</div></div><div class="kpi"><div class="lbl">Target Prod</div><div class="val">${totalTargetProd.toLocaleString()}</div></div><div class="kpi"><div class="lbl">Target MPH</div><div class="val">${Math.round(totalTargetMPH).toLocaleString()}</div></div><div class="kpi"><div class="lbl">Planned L/G</div><div class="val" style="color:${totalPlannedLG > 0 ? "#dc2626" : totalPlannedLG < 0 ? "#16a34a" : "#6b7280"}">${totalPlannedLG.toLocaleString()}</div></div><div class="kpi"><div class="lbl">Efficiency</div><div class="val">${overallEff}%</div></div></div>${sortedDepts.length === 0 ? `<div style="text-align:center;padding:40px;color:#6b7280">No entries found for ${dateLabel}</div>` : deptSections}</body></html>`;

      try {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        const triggerPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {}
        };

        if (printWindow.document.readyState === "complete") {
          triggerPrint();
        } else {
          printWindow.onload = triggerPrint;
        }
        printWindow.addEventListener("afterprint", () => {
          try { printWindow.close(); } catch {}
        });
      } catch {}
    }, 0);
  };

  const handlePrintVerification = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.open();
    printWindow.document.write(
      `<!doctype html><html><head><title>Preparing print…</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555;font-size:14px}</style></head><body>Preparing print…</body></html>`
    );
    printWindow.document.close();

    setTimeout(() => {
      const dateLabel = format(selectedDate, "dd MMM yyyy");

      const SMALL_DEPT_THRESHOLD = 12;

      const renderDeptBlock = (dept: string, half: boolean) => {
        const items = grouped[dept];
        if (!items || items.length === 0) return "";
        const rows = items
          .map((e, idx) => {
            return `<tr><td class="c">${idx + 1}</td><td class="nowrap">${e.employee_code}</td><td class="nowrap">${e.employee_name}</td><td class="nowrap">${e.category}</td><td class="wrap">${e.process_name}</td><td class="r">${e.mph}</td><td class="checkbox-cell"></td></tr>`;
          })
          .join("");

        return `<div class="dept-section${half ? " half" : ""}"><div class="dept-header">${dept} — ${items.length} workers</div><table><thead><tr><th style="width:6mm">#</th><th class="nowrap">Code</th><th class="nowrap">Name</th><th class="nowrap">Cat</th><th>Process</th><th style="width:12mm" class="r">MPH</th><th style="width:8mm" class="c">✓</th></tr></thead><tbody>${rows}</tbody></table><div class="signature">Verified by: ____________  Signature: ____________  Date: __________</div></div>`;
      };

      // Split depts into small (paired side-by-side) and large (full width)
      const smallDepts: string[] = [];
      const largeDepts: string[] = [];
      sortedDepts.forEach((d) => {
        const count = grouped[d]?.length ?? 0;
        if (count > 0 && count <= SMALL_DEPT_THRESHOLD) smallDepts.push(d);
        else if (count > 0) largeDepts.push(d);
      });

      // Pair small depts into 2-column rows
      const smallRows: string[] = [];
      for (let i = 0; i < smallDepts.length; i += 2) {
        const left = renderDeptBlock(smallDepts[i], true);
        const right = smallDepts[i + 1] ? renderDeptBlock(smallDepts[i + 1], true) : `<div class="dept-section half"></div>`;
        smallRows.push(`<div class="dept-row">${left}${right}</div>`);
      }

      const deptSections =
        largeDepts.map((d) => renderDeptBlock(d, false)).join("") + smallRows.join("");

      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Physical Attendance Verification - ${dateLabel}</title><style>@page{size:A4 portrait;margin:8mm 6mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;line-height:1.15;color:#111;margin:0;padding:0}.header{display:flex;justify-content:space-between;align-items:baseline;font-size:10pt;font-weight:700;border-bottom:1px solid #555;padding-bottom:2px;margin-bottom:4px}.header .sub{font-size:8pt;font-weight:400;color:#444}.dept-row{display:flex;gap:4mm;page-break-inside:avoid}.dept-section{margin-bottom:4mm;page-break-inside:avoid}.dept-section.half{flex:1 1 0;min-width:0}.dept-header{background:#e5e7eb;padding:2px 4px;font-size:9pt;font-weight:700;border:0.5px solid #999;border-bottom:0}table{width:100%;border-collapse:collapse;font-size:8pt;table-layout:auto}th,td{border:0.5px solid #999;padding:2px 4px;line-height:1.15;vertical-align:top}th{background:#f3f4f6;font-weight:600;text-align:left}td.c,th.c{text-align:center}td.r,th.r{text-align:right}td.nowrap,th.nowrap{white-space:nowrap;width:1%}td.wrap{white-space:normal;word-break:break-word}.checkbox-cell{height:8mm;width:8mm}.signature{margin-top:2mm;font-size:7.5pt;color:#374151}@media print{body{padding:0}}</style></head><body><div class="header"><span>Physical Attendance Verification — ${dateLabel}</span><span class="sub">Total: ${totalWorkers} workers · Printed ${format(new Date(), "dd MMM HH:mm")}</span></div>${sortedDepts.length === 0 ? `<div style="text-align:center;padding:40px;color:#6b7280">No entries found for ${dateLabel}</div>` : deptSections}</body></html>`;

      try {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        const triggerPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {}
        };

        if (printWindow.document.readyState === "complete") {
          triggerPrint();
        } else {
          printWindow.onload = triggerPrint;
        }
        printWindow.addEventListener("afterprint", () => {
          try { printWindow.close(); } catch {}
        });
      } catch {}
    }, 0);
  };

  const getEffBadge = (actual: number, target: number) => {
    if (target === 0) return <Badge variant="secondary">-</Badge>;
    const eff = Math.round((actual / target) * 100);
    if (eff >= 100) return <Badge className="bg-green-600 text-white">{eff}%</Badge>;
    if (eff >= 80) return <Badge className="bg-yellow-500 text-white">{eff}%</Badge>;
    return <Badge variant="destructive">{eff}%</Badge>;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Todays Labour Deployment & Targets" description="Department-wise daily target overview" icon={Target} iconColor="bg-emerald-500 text-white">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={handlePrint} disabled={isLoading}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" className="gap-2" onClick={handlePrintVerification} disabled={isLoading}>
            <ClipboardCheck className="h-4 w-4" />
            Print Verification Sheet
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {format(selectedDate, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-9 gap-4">
        <MetricCard title="Total Workers" value={totalWorkers} icon={Users} />
        <MetricCard title="Std Target" value={totalStdTarget.toLocaleString()} icon={Target} />
        <MetricCard title="Today's Target" value={totalTodaysTarget.toLocaleString()} icon={Target} iconColor="text-emerald-500" />
        <MetricCard title="Actual" value={totalActual.toLocaleString()} icon={TrendingUp} />
        <MetricCard title="MPH Deployed" value={totalMPH.toLocaleString()} icon={Clock} iconColor="text-blue-500" />
        <MetricCard title="Target Prod" value={totalTargetProd.toLocaleString()} icon={Factory} iconColor="text-orange-500" />
        <MetricCard title="Target MPH" value={Math.round(totalTargetMPH).toLocaleString()} icon={Clock} iconColor="text-violet-500" />
        <MetricCard title="Planned L/G" value={totalPlannedLG.toLocaleString()} icon={ArrowUpDown} iconColor={lgColor} />
        <MetricCard title="Efficiency" value={`${overallEff}%`} icon={TrendingUp} iconColor={overallEff >= 100 ? "text-green-600" : overallEff >= 80 ? "text-yellow-500" : "text-red-500"} />
      </div>

      {/* Department Sections */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : sortedDepts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No entries found for {format(selectedDate, "dd MMM yyyy")}</div>
      ) : (
        <div className="space-y-3">
          {sortedDepts.map((dept) => {
            const items = grouped[dept];
            const isOpen = openDepts[dept] !== false; // default open
            const deptStd = items.reduce((s, e) => s + e.target_quantity, 0);
            const deptToday = items.reduce((s, e) => s + (e.todays_target || 0), 0);
            const deptActual = items.reduce((s, e) => s + e.actual_quantity, 0);
            const deptMPH = items.reduce((s, e) => s + e.mph, 0);
            const deptId = items[0]?.department_id || "";
            const deptProd = (prodData as Record<string, { targetProd: number; produced: number }>)[deptId];
            const deptTargetProd = deptProd?.targetProd || 0;

            return (
              <Collapsible key={dept} open={isOpen} onOpenChange={() => toggleDept(dept)}>
                <div className="border rounded-lg bg-card">
                  <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="font-semibold text-base">{dept}</span>
                      <Badge variant="secondary">{items.length} workers</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>MPH: <strong className="text-blue-600">{deptMPH}</strong></span>
                      <span>Target Prod: <strong className="text-orange-600">{deptTargetProd.toLocaleString()}</strong></span>
                      <span>Target MPH: <strong className="text-violet-600">{Math.round(targetMPHByDept[deptId] || 0).toLocaleString()}</strong></span>
                      {(() => { const dLG = deptMPH - Math.round(targetMPHByDept[deptId] || 0); const c = dLG > 0 ? "text-red-600" : dLG < 0 ? "text-green-600" : "text-muted-foreground"; return <span>P. L/G: <strong className={c}>{dLG}</strong></span>; })()}
                      <span>Std: <strong className="text-foreground">{deptStd}</strong></span>
                      <span>Today: <strong className="text-foreground">{deptToday}</strong></span>
                      <span>Actual: <strong className="text-foreground">{deptActual}</strong></span>
                      {getEffBadge(deptActual, deptToday || deptStd)}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Process</TableHead>
                            <TableHead>Shift</TableHead>
                            <TableHead>Check In</TableHead>
                            <TableHead>Check Out</TableHead>
                            <TableHead className="text-right">MPH</TableHead>
                            <TableHead className="text-right">Std Target</TableHead>
                            <TableHead className="text-right">Today's Target</TableHead>
                            <TableHead className="text-right">Actual</TableHead>
                            <TableHead className="text-center">Efficiency</TableHead>
                            <TableHead>Remarks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <EmployeeAvatar name={entry.employee_name} photoUrl={entry.employee_photo} className="h-7 w-7" />
                                  <span>{entry.employee_name}</span>
                                </div>
                              </TableCell>
                              <TableCell>{entry.employee_code}</TableCell>
                              <TableCell>{entry.category}</TableCell>
                              <TableCell>{entry.process_name}</TableCell>
                              <TableCell>{entry.shift}</TableCell>
                              <TableCell>{fmtTime(entry.check_in)}</TableCell>
                              <TableCell>{fmtTime(entry.check_out)}</TableCell>
                              <TableCell className="text-right">{entry.mph}</TableCell>
                              <TableCell className="text-right">{entry.target_quantity}</TableCell>
                              <TableCell className="text-right">{entry.todays_target ?? "-"}</TableCell>
                              <TableCell className="text-right">{entry.actual_quantity}</TableCell>
                              <TableCell className="text-center">
                                {getEffBadge(entry.actual_quantity, entry.todays_target || entry.target_quantity)}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">{entry.remarks || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
