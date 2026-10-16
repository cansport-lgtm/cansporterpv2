import { useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import {
  QAPlanItemExport,
  buildQADashboardPdf,
  downloadBlob,
  downloadQADashboardExcel,
  exportFileBase,
  fetchQADashboardExportData,
} from "@/lib/qaDashboardExport";

function DatePickerField({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
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

interface Props {
  defaultFrom: Date;
  defaultTo: Date;
  keyProcessCodes: string[];
  todayPlanDate: string;
  todayPlanItems: QAPlanItemExport[];
}

export function QADashboardExportButton({ defaultFrom, defaultTo, keyProcessCodes, todayPlanDate, todayPlanItems }: Props) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(defaultFrom);
  const [toDate, setToDate] = useState<Date>(defaultTo);
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);

  const handleOpenChange = (next: boolean) => {
    // Start from the period currently shown on the Total Inspections card.
    if (next) {
      setFromDate(defaultFrom);
      setToDate(defaultTo);
    }
    setOpen(next);
  };

  const setPreset = (preset: "this-month" | "last-month") => {
    const base = new Date();
    if (preset === "last-month") base.setMonth(base.getMonth() - 1, 1);
    setFromDate(startOfMonth(base));
    setToDate(endOfMonth(base));
  };

  const run = async (kind: "excel" | "pdf") => {
    if (fromDate > toDate) {
      toast.error("From date must be on or before To date");
      return;
    }
    setBusy(kind);
    try {
      const data = await fetchQADashboardExportData({ fromDate, toDate, keyProcessCodes, todayPlanDate, todayPlanItems });
      if (kind === "excel") {
        await downloadQADashboardExcel(data);
      } else {
        downloadBlob(buildQADashboardPdf(data), `${exportFileBase(data)}.pdf`);
      }
      toast.success(`Exported ${data.inspections.length} inspections`);
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export QA Dashboard</DialogTitle>
          <DialogDescription>
            All charts as tables for one period. Excel has one sheet per chart plus full inspection and
            reading data for analysis; PDF is a printable report.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <DatePickerField label="From" value={fromDate} onChange={setFromDate} />
          <DatePickerField label="To" value={toDate} onChange={setToDate} />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPreset("this-month")}>This month</Button>
          <Button variant="ghost" size="sm" onClick={() => setPreset("last-month")}>Last month</Button>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => run("pdf")} className="gap-2">
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            PDF
          </Button>
          <Button disabled={!!busy} onClick={() => run("excel")} className="gap-2">
            {busy === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
