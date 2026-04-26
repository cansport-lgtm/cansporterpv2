import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";
import { toast } from "sonner";

interface InspectionQRScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanned: (value: string) => void;
}

export function InspectionQRScannerDialog({ open, onOpenChange, onScanned }: InspectionQRScannerDialogProps) {
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastProcessedRef = useRef<string>("");

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {
      // ignore
    }
    scannerRef.current = null;
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    await stopScanner();
    await new Promise((r) => setTimeout(r, 300));

    const container = document.getElementById("inspection-qr-reader");
    if (!container) return;

    try {
      const scanner = new Html5Qrcode("inspection-qr-reader");
      scannerRef.current = scanner;
      const containerWidth = container.clientWidth || 300;
      const qrboxSize = Math.min(containerWidth - 40, 250);

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: qrboxSize, height: qrboxSize }, aspectRatio: 4 / 3 },
        (decodedText) => {
          if (decodedText === lastProcessedRef.current) return;
          lastProcessedRef.current = decodedText;
          setTimeout(() => { lastProcessedRef.current = ""; }, 2000);
          onScanned(decodedText);
          toast.success("QR code scanned!");
          onOpenChange(false);
        },
        () => {}
      );
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        toast.error("Camera permission denied.");
      } else if (msg.includes("NotFoundError")) {
        toast.error("No camera found.");
      } else {
        toast.error("Camera failed: " + msg);
      }
    }
  }, [onScanned, onOpenChange, stopScanner]);

  useEffect(() => {
    if (!open) {
      stopScanner();
      lastProcessedRef.current = "";
    }
  }, [open, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> Scan Tracking QR Code
          </DialogTitle>
          <DialogDescription>
            Scan the QR/barcode on the physical tag to auto-fill tracking number
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            id="inspection-qr-reader"
            className="w-full rounded-lg overflow-hidden bg-muted"
            style={{ minHeight: scanning ? "auto" : "200px" }}
          />

          {!scanning && (
            <div className="text-center text-muted-foreground py-4">
              <Camera className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Tap Start to begin scanning</p>
            </div>
          )}

          {!scanning ? (
            <Button onClick={startScanner} className="w-full">
              <Camera className="h-4 w-4 mr-2" /> Start Scanner
            </Button>
          ) : (
            <Button onClick={stopScanner} variant="destructive" className="w-full">
              <CameraOff className="h-4 w-4 mr-2" /> Stop Scanner
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
