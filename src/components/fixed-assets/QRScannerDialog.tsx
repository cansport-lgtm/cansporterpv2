import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, CameraOff, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface QRScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssetScanned: (assetCode: string) => void;
  scannedCodes: string[];
}

export function QRScannerDialog({ open, onOpenChange, onAssetScanned, scannedCodes }: QRScannerDialogProps) {
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<"success" | "duplicate" | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastProcessedRef = useRef<string>("");
  const scannedCodesRef = useRef<string[]>(scannedCodes);

  // Keep ref in sync
  useEffect(() => {
    scannedCodesRef.current = scannedCodes;
  }, [scannedCodes]);

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current) {
        const isScanning = scannerRef.current.isScanning;
        if (isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      }
    } catch {
      // ignore cleanup errors
    }
    scannerRef.current = null;
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    // Ensure previous instance is cleaned up
    await stopScanner();

    // Small delay to let DOM settle after dialog animation
    await new Promise((r) => setTimeout(r, 300));

    const container = document.getElementById("qr-reader-container");
    if (!container) {
      toast.error("Scanner container not found");
      return;
    }

    try {
      const scanner = new Html5Qrcode("qr-reader-container");
      scannerRef.current = scanner;

      const containerWidth = container.clientWidth || 300;
      const qrboxSize = Math.min(containerWidth - 40, 250);

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: qrboxSize, height: qrboxSize },
          aspectRatio: 4 / 3,
        },
        (decodedText) => {
          // Debounce: skip if same code scanned within 2s
          if (decodedText === lastProcessedRef.current) return;
          lastProcessedRef.current = decodedText;
          setTimeout(() => { lastProcessedRef.current = ""; }, 2000);

          setLastScanned(decodedText);
          if (scannedCodesRef.current.includes(decodedText)) {
            setScanResult("duplicate");
          } else {
            setScanResult("success");
            onAssetScanned(decodedText);
          }
          setTimeout(() => setScanResult(null), 1500);
        },
        () => {}
      );
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        toast.error("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (msg.includes("NotFoundError") || msg.includes("no camera")) {
        toast.error("No camera found on this device.");
      } else {
        toast.error("Camera failed: " + msg);
      }
    }
  }, [onAssetScanned, stopScanner]);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setLastScanned(null);
      setScanResult(null);
      lastProcessedRef.current = "";
    }
  }, [open, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> QR Code Scanner
          </DialogTitle>
          <DialogDescription>
            Scan tracking barcode or QR code
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanner container - always rendered, html5-qrcode manages its content */}
          <div
            id="qr-reader-container"
            className="w-full rounded-lg overflow-hidden bg-muted"
            style={{ minHeight: scanning ? "auto" : "200px" }}
          />

          {!scanning && (
            <div className="text-center text-muted-foreground py-4">
              <Camera className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Tap Start to begin scanning</p>
            </div>
          )}

          <div>
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

          {lastScanned && (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              {scanResult === "success" && <CheckCircle className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--primary))" }} />}
              {scanResult === "duplicate" && <XCircle className="h-5 w-5 shrink-0 text-muted-foreground" />}
              {!scanResult && <CheckCircle className="h-5 w-5 text-muted-foreground shrink-0" />}
              <div>
                <p className="font-mono font-medium text-sm">{lastScanned}</p>
                {scanResult === "success" && <p className="text-xs" style={{ color: "hsl(var(--primary))" }}>Marked as Found</p>}
                {scanResult === "duplicate" && <p className="text-xs text-muted-foreground">Already verified</p>}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Scanned in this session:</span>
            <Badge variant="secondary">{scannedCodes.length}</Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
