import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Download, UserX, Loader2, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface MissingRow {
  id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  target_date: string;
  check_in: string | null;
  check_out: string | null;
}

interface UnknownRow {
  id: string;
  employee_code: string;
  target_date: string;
  check_in: string | null;
  check_out: string | null;
}

const parseTime = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const totalSec = Math.round(v * 24 * 60 * 60);
    const hh = Math.floor(totalSec / 3600) % 24;
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
};

const parseDate = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const parsed = new Date(String(v).trim());
  if (isNaN(parsed.getTime())) return null;
  return format(parsed, "yyyy-MM-dd");
};

const MissingProductivityEntriesPage = () => {
  const { hasRole, hasModulePermission } = useAuth();
  const canUse =
    hasRole("super_admin") || (hasRole("manager") && hasModulePermission("labour", "view"));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [unknown, setUnknown] = useState<UnknownRow[]>([]);
  const [stats, setStats] = useState<{ total: number; matched: number; missing: number; unknown: number; noTime: number }>({
    total: 0,
    matched: 0,
    missing: 0,
    unknown: 0,
    noTime: 0,
  });
  const [searchTerm, setSearchTerm] = useState("");

  const downloadSample = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "Employee Code": "EMP001", Date: "2026-05-12", "Check In": "09:00", "Check Out": "18:00" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, "attendance_sample.xlsx");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) {
        toast.error("No rows found in file");
        return;
      }

      // Load employees and departments
      const [{ data: empList }, { data: deptList }] = await Promise.all([
        supabase.from("labour_employees").select("id, employee_code, full_name, department_id"),
        supabase.from("production_departments").select("id, name"),
      ]);

      const empMap = new Map<string, { id: string; full_name: string; department_id: string | null; employee_code: string }>();
      (empList || []).forEach((emp: any) => {
        if (emp.employee_code) empMap.set(String(emp.employee_code).trim().toLowerCase(), emp);
      });
      const deptMap = new Map<string, string>();
      (deptList || []).forEach((d: any) => deptMap.set(d.id, d.name));

      // Parse rows
      type Parsed = {
        rawCode: string;
        empId: string | null;
        empName: string;
        deptName: string;
        targetDate: string;
        checkIn: string | null;
        checkOut: string | null;
      };
      const parsed: Parsed[] = [];
      let noTimeCount = 0;
      const dateSet = new Set<string>();
      const empIdSet = new Set<string>();

      for (const row of rows) {
        const rawCode = String(row["Employee Code"] ?? row["employee_code"] ?? "").trim();
        const targetDate = parseDate(row["Date"] ?? row["date"]);
        const checkIn = parseTime(row["Check In"] ?? row["check_in"]);
        const checkOut = parseTime(row["Check Out"] ?? row["check_out"]);
        if (!targetDate) continue;
        if (!checkIn && !checkOut) {
          noTimeCount++;
          continue;
        }
        const emp = empMap.get(rawCode.toLowerCase()) || null;
        parsed.push({
          rawCode,
          empId: emp?.id || null,
          empName: emp?.full_name || "",
          deptName: emp?.department_id ? deptMap.get(emp.department_id) || "-" : "-",
          targetDate,
          checkIn,
          checkOut,
        });
        dateSet.add(targetDate);
        if (emp?.id) empIdSet.add(emp.id);
      }

      // Fetch existing entries within date range
      const dates = Array.from(dateSet);
      let existingSet = new Set<string>();
      if (dates.length > 0 && empIdSet.size > 0) {
        const minDate = dates.reduce((a, b) => (a < b ? a : b));
        const maxDate = dates.reduce((a, b) => (a > b ? a : b));
        const empIds = Array.from(empIdSet);
        // Chunk emp ids to avoid URL length issues
        const chunks: string[][] = [];
        for (let i = 0; i < empIds.length; i += 200) chunks.push(empIds.slice(i, i + 200));
        for (const chunk of chunks) {
          const { data, error } = await supabase
            .from("labour_productivity_targets")
            .select("employee_id, target_date")
            .gte("target_date", minDate)
            .lte("target_date", maxDate)
            .in("employee_id", chunk);
          if (error) throw error;
          (data || []).forEach((r: any) => existingSet.add(`${r.employee_id}::${r.target_date}`));
        }
      }

      const missingRows: MissingRow[] = [];
      const unknownRows: UnknownRow[] = [];
      let matched = 0;

      parsed.forEach((p, idx) => {
        if (!p.empId) {
          unknownRows.push({
            id: `u-${idx}`,
            employee_code: p.rawCode || "(blank)",
            target_date: p.targetDate,
            check_in: p.checkIn,
            check_out: p.checkOut,
          });
          return;
        }
        const key = `${p.empId}::${p.targetDate}`;
        if (existingSet.has(key)) {
          matched++;
        } else {
          missingRows.push({
            id: `m-${idx}`,
            employee_code: p.rawCode,
            employee_name: p.empName,
            department: p.deptName,
            target_date: p.targetDate,
            check_in: p.checkIn,
            check_out: p.checkOut,
          });
        }
      });

      setMissing(missingRows);
      setUnknown(unknownRows);
      setStats({
        total: rows.length,
        matched,
        missing: missingRows.length,
        unknown: unknownRows.length,
        noTime: noTimeCount,
      });
      toast.success(`Found ${missingRows.length} missing entries`);
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filteredMissing = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return missing;
    return missing.filter(
      (m) =>
        m.employee_code.toLowerCase().includes(q) ||
        m.employee_name.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q) ||
        m.target_date.includes(q),
    );
  }, [missing, searchTerm]);

  const exportMissing = () => {
    if (missing.length === 0) {
      toast.error("No missing entries to export");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(
      missing.map((m) => ({
        "Employee Code": m.employee_code,
        "Employee Name": m.employee_name,
        Department: m.department,
        Date: m.target_date,
        "Check In": m.check_in || "",
        "Check Out": m.check_out || "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Missing Entries");
    XLSX.writeFile(wb, `missing_productivity_entries_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`);
  };

  if (!canUse) {
    return (
      <ERPLayout>
        <div className="p-6">
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              You do not have permission to access this page.
            </CardContent>
          </Card>
        </div>
      </ERPLayout>
    );
  }

  const columns = [
    { key: "employee_code", header: "Code" },
    { key: "employee_name", header: "Employee" },
    { key: "department", header: "Department" },
    { key: "target_date", header: "Date" },
    {
      key: "check_in",
      header: "Check In",
      render: (m: MissingRow) => m.check_in || "-",
    },
    {
      key: "check_out",
      header: "Check Out",
      render: (m: MissingRow) => m.check_out || "-",
    },
  ];

  const unknownColumns = [
    { key: "employee_code", header: "Code (not found)" },
    { key: "target_date", header: "Date" },
    { key: "check_in", header: "Check In", render: (u: UnknownRow) => u.check_in || "-" },
    { key: "check_out", header: "Check Out", render: (u: UnknownRow) => u.check_out || "-" },
  ];

  return (
    <ERPLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <PageHeader
          title="Missing Productivity Entries"
          description="Upload an attendance file to find employees marked present but without a productivity entry."
          icon={UserX}
          iconColor="bg-amber-500 text-white"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="outline" onClick={downloadSample}>
            <Download className="h-4 w-4 mr-2" />
            Sample
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Upload Attendance
          </Button>
          {missing.length > 0 && (
            <Button variant="outline" onClick={exportMissing}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export
            </Button>
          )}
        </PageHeader>

        {stats.total > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase">Total Rows</div>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase">Matched</div>
                <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
              </CardContent>
            </Card>
            <Card className="border-amber-300">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase">Missing Entries</div>
                <div className="text-2xl font-bold text-amber-600">{stats.missing}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase">Unknown Code</div>
                <div className="text-2xl font-bold text-red-600">{stats.unknown}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase">Skipped (no time)</div>
                <div className="text-2xl font-bold text-muted-foreground">{stats.noTime}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {missing.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Missing Entries ({filteredMissing.length})</h2>
              <Input
                placeholder="Search by code, name, dept, date..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <DataTable
              columns={columns}
              data={filteredMissing}
              emptyMessage="No missing entries match the search."
            />
          </div>
        )}

        {unknown.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-red-600">
              Unknown Employee Codes ({unknown.length})
            </h2>
            <DataTable
              columns={unknownColumns}
              data={unknown}
              emptyMessage="None"
            />
          </div>
        )}

        {stats.total === 0 && !isProcessing && (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              Upload an attendance Excel file with columns: Employee Code, Date, Check In, Check Out.
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
};

export default MissingProductivityEntriesPage;
