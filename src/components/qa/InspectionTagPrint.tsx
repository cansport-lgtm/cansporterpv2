import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer } from "lucide-react";

interface InspectionTagPrintProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspectionNumber: string;
  trackingNumber: string;
  processName: string;
  inspectionDate: string;
  result: string;
}

export function InspectionTagPrint({
  open,
  onOpenChange,
  inspectionNumber,
  trackingNumber,
  processName,
  inspectionDate,
  result,
}: InspectionTagPrintProps) {
  const qrValue = `INS:${inspectionNumber}|TRK:${trackingNumber}`;

  const handlePrint = () => {
    const printArea = document.getElementById("inspection-tag-print");
    if (!printArea) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Inspection Tag</title>
      <style>
        @page { size: 50mm 25mm; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { width: 50mm; height: 25mm; font-family: Arial, sans-serif; }
        .tag {
          width: 50mm; height: 25mm;
          display: flex; flex-direction: row; align-items: center;
          padding: 1.5mm 2mm;
          border: 0.3mm solid #333;
        }
        .tag .qr { flex-shrink: 0; margin-right: 2mm; }
        .tag .info { flex: 1; min-width: 0; }
        .tag .info .row { font-size: 7px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tag .info .row .label { color: #666; font-size: 6px; }
        .tag .info .row .value { font-weight: bold; font-family: monospace; }
        .tag .info .result-row { margin-top: 1mm; }
        .tag .info .result {
          font-size: 7px; font-weight: bold; text-transform: uppercase;
          padding: 0.5mm 2mm; border-radius: 1mm; display: inline-block;
        }
        .tag .info .result.pass { background: #dcfce7; color: #166534; }
        .tag .info .result.fail { background: #fee2e2; color: #991b1b; }
        .tag .info .result.hold { background: #fef9c3; color: #854d0e; }
      </style></head><body>
        <div class="tag">
          <div class="qr">${document.getElementById("tag-qr-print")?.innerHTML || ""}</div>
          <div class="info">
            <div class="row"><span class="value">${inspectionNumber}</span></div>
            <div class="row"><span class="label">TRK: </span><span class="value">${trackingNumber}</span></div>
            <div class="row">${processName}</div>
            <div class="row">${inspectionDate}</div>
            <div class="result-row"><span class="result ${result}">${result}</span></div>
          </div>
        </div>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" /> Print Inspection Tag
          </DialogTitle>
        </DialogHeader>

        <div id="inspection-tag-print">
          <div className="border-2 border-foreground/30 rounded-lg p-4 text-center space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Inspection Tag (50mm × 25mm)
            </div>
            <div className="flex justify-center" id="tag-qr-print">
              <QRCodeSVG value={qrValue} size={50} level="M" />
            </div>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Inspection #: </span>
                <span className="font-mono font-bold">{inspectionNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Tracking #: </span>
                <span className="font-mono font-bold">{trackingNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Process: </span>
                <span className="font-medium">{processName}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Date: </span>
                <span className="font-medium">{inspectionDate}</span>
              </div>
            </div>
            <div>
              <span className={`inline-block px-3 py-1 rounded text-xs font-bold uppercase ${
                result === "pass" ? "bg-green-100 text-green-700" :
                result === "fail" ? "bg-red-100 text-red-700" :
                "bg-yellow-100 text-yellow-700"
              }`}>
                {result}
              </span>
            </div>
          </div>
        </div>

        <Button onClick={handlePrint} className="w-full">
          <Printer className="h-4 w-4 mr-2" /> Print Tag
        </Button>
      </DialogContent>
    </Dialog>
  );
}
