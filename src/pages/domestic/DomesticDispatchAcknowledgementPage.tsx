import { useState, useCallback } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QrCode, Search, CheckCircle2, Upload, Camera, CameraOff, FileCheck, Eye } from "lucide-react";
import { format } from "date-fns";
import { Html5Qrcode } from "html5-qrcode";
import { useRef } from "react";

const STATUS_COLORS: Record<string, string> = {
  delivered: "bg-green-500",
  acknowledged: "bg-purple-500",
};

export default function DomesticDispatchAcknowledgementPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [ackDialog, setAckDialog] = useState<any>(null);
  const [receiverName, setReceiverName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [docUrl, setDocUrl] = useState<string | null>(null);

  // Fetch dispatches with delivered or acknowledged status
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ["domestic-dispatch-acknowledgement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_dispatches")
        .select(`
          *,
          sales_dispatch_items(
            *,
            sales_order_items(
              *,
              products(*),
              sales_orders(order_number, customers(name, code))
            )
          )
        `)
        .in("delivery_status", ["delivered", "acknowledged"])
        .order("dispatch_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const getDispatchCustomers = (dispatch: any) => {
    const names = new Set<string>();
    dispatch.sales_dispatch_items?.forEach((item: any) => {
      const name = item.sales_order_items?.sales_orders?.customers?.name;
      if (name) names.add(name);
    });
    return Array.from(names).join(", ") || "-";
  };

  const getDispatchOrders = (dispatch: any) => {
    const orders = new Set<string>();
    dispatch.sales_dispatch_items?.forEach((item: any) => {
      const num = item.sales_order_items?.sales_orders?.order_number;
      if (num) orders.add(num);
    });
    return Array.from(orders).join(", ") || "-";
  };

  const filtered = dispatches?.filter((d: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      d.dispatch_number?.toLowerCase().includes(term) ||
      getDispatchCustomers(d).toLowerCase().includes(term)
    );
  });

  // Acknowledge mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async ({
      id,
      receiver_name,
      acknowledgement_doc_url,
    }: {
      id: string;
      receiver_name: string;
      acknowledgement_doc_url: string | null;
    }) => {
      const { error } = await supabase
        .from("sales_dispatches")
        .update({
          delivery_status: "acknowledged",
          receiver_name,
          acknowledgement_date: new Date().toISOString(),
          acknowledgement_doc_url,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dispatch acknowledged successfully");
      queryClient.invalidateQueries({ queryKey: ["domestic-dispatch-acknowledgement"] });
      closeAckDialog();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeAckDialog = () => {
    setAckDialog(null);
    setReceiverName("");
    setDocUrl(null);
  };

  const openAckForDispatch = (dispatch: any) => {
    if (dispatch.delivery_status === "acknowledged") {
      toast.info("This dispatch is already acknowledged");
      return;
    }
    setAckDialog(dispatch);
    setReceiverName("");
    setDocUrl(null);
  };

  // File upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `acknowledgements/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("expense-attachments")
        .upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from("expense-attachments")
        .getPublicUrl(path);
      setDocUrl(urlData.publicUrl);
      toast.success("Document uploaded");
    } catch (err: any) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  // QR Scanner
  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {}
    scannerRef.current = null;
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    await stopScanner();
    await new Promise((r) => setTimeout(r, 300));
    const container = document.getElementById("ack-qr-reader");
    if (!container) return;
    try {
      const scanner = new Html5Qrcode("ack-qr-reader");
      scannerRef.current = scanner;
      const w = container.clientWidth || 300;
      const qrbox = Math.min(w - 40, 250);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: qrbox, height: qrbox }, aspectRatio: 4 / 3 },
        (decodedText) => {
          try {
            const parsed = JSON.parse(decodedText);
            const dispatchNum = parsed.dispatch;
            if (!dispatchNum) {
              toast.error("Invalid QR code");
              return;
            }
            const found = dispatches?.find(
              (d: any) => d.dispatch_number === dispatchNum
            );
            if (!found) {
              toast.error(`Dispatch ${dispatchNum} not found or not in delivered status`);
              return;
            }
            stopScanner();
            setScannerOpen(false);
            openAckForDispatch(found);
          } catch {
            toast.error("Could not parse QR code data");
          }
        },
        () => {}
      );
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        toast.error("Camera permission denied");
      } else {
        toast.error("Camera failed: " + msg);
      }
    }
  }, [dispatches, stopScanner]);

  const handleScannerClose = (open: boolean) => {
    if (!open) stopScanner();
    setScannerOpen(open);
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Dispatch Acknowledgement"
          description="Scan QR code on signed dispatch sheet to acknowledge delivery receipt"
          icon={FileCheck}
          iconColor="bg-purple-600 text-white"
        />

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search dispatch number or customer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button onClick={() => setScannerOpen(true)} className="bg-purple-600 hover:bg-purple-700">
                <QrCode className="h-4 w-4 mr-2" /> Scan QR Code
              </Button>
            </div>

            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispatch #</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Dispatch Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Receiver</TableHead>
                     <TableHead>Doc</TableHead>
                     <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : !filtered?.length ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No delivered dispatches found</TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((dispatch: any) => (
                      <TableRow key={dispatch.id}>
                        <TableCell className="font-mono">{dispatch.dispatch_number}</TableCell>
                        <TableCell className="max-w-32 truncate">{getDispatchOrders(dispatch)}</TableCell>
                        <TableCell className="max-w-32 truncate">{getDispatchCustomers(dispatch)}</TableCell>
                        <TableCell>{format(new Date(dispatch.dispatch_date), "dd MMM yyyy")}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[dispatch.delivery_status] || "bg-muted"}>
                            {dispatch.delivery_status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>{(dispatch as any).receiver_name || "-"}</TableCell>
                        <TableCell>
                          {(dispatch as any).acknowledgement_doc_url ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-purple-600 hover:text-purple-700"
                              onClick={() => window.open((dispatch as any).acknowledgement_doc_url, '_blank')}
                            >
                              <Eye className="h-4 w-4 mr-1" /> View
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {dispatch.delivery_status === "delivered" ? (
                            <Button size="sm" onClick={() => openAckForDispatch(dispatch)}>
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Acknowledge
                            </Button>
                          ) : (
                            <Badge variant="outline" className="text-purple-600 border-purple-300">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Done
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QR Scanner Dialog */}
      <Dialog open={scannerOpen} onOpenChange={handleScannerClose}>
        <DialogContent className="max-w-lg w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" /> Scan Dispatch QR Code
            </DialogTitle>
            <DialogDescription>Point camera at the QR code on the signed dispatch sheet</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div id="ack-qr-reader" className="w-full rounded-lg overflow-hidden bg-muted" style={{ minHeight: scanning ? "auto" : "200px" }} />
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

      {/* Acknowledgement Dialog */}
      <Dialog open={!!ackDialog} onOpenChange={(o) => !o && closeAckDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Acknowledgement</DialogTitle>
            <DialogDescription>Dispatch: {ackDialog?.dispatch_number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Customer</p>
                <p className="font-medium">{ackDialog && getDispatchCustomers(ackDialog)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Dispatch Date</p>
                <p className="font-medium">
                  {ackDialog && format(new Date(ackDialog.dispatch_date), "dd MMM yyyy")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Vehicle</p>
                <p className="font-medium">{ackDialog?.vehicle_number || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Orders</p>
                <p className="font-medium">{ackDialog && getDispatchOrders(ackDialog)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Receiver Name *</Label>
              <Input
                placeholder="Name of person who received goods"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Upload Signed Dispatch Sheet</Label>
              <div className="flex items-center gap-3">
                <label className="flex-1">
                  <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors">
                    <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {uploading ? "Uploading..." : docUrl ? "Document uploaded ✓" : "Click to upload scan/photo"}
                    </p>
                  </div>
                  <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileUpload} disabled={uploading} />
                </label>
              </div>
              {docUrl && (
                <p className="text-xs text-green-600 truncate">✓ {docUrl.split("/").pop()}</p>
              )}
            </div>

            <Button
              className="w-full bg-purple-600 hover:bg-purple-700"
              disabled={!receiverName.trim() || acknowledgeMutation.isPending}
              onClick={() => {
                if (!ackDialog) return;
                acknowledgeMutation.mutate({
                  id: ackDialog.id,
                  receiver_name: receiverName.trim(),
                  acknowledgement_doc_url: docUrl,
                });
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {acknowledgeMutation.isPending ? "Saving..." : "Confirm Acknowledgement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
