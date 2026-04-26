import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { QrCode, CheckCircle2, Camera, ArrowLeft, Loader2 } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";

interface Machine {
  id: string;
  name: string;
  code: string;
  department: string | null;
  location: string | null;
  custom_statuses: string[];
  current_status: string;
  current_status_since: string;
  current_remarks: string | null;
  is_active: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  Running: "bg-green-100 text-green-700 border-green-300",
  Stopped: "bg-slate-100 text-slate-600 border-slate-300",
  Idle: "bg-yellow-100 text-yellow-700 border-yellow-300",
  Breakdown: "bg-red-100 text-red-700 border-red-300",
  Maintenance: "bg-blue-100 text-blue-700 border-blue-300",
  Setup: "bg-purple-100 text-purple-700 border-purple-300",
};

export default function MachineQRScanPage() {
  const [searchParams] = useSearchParams();
  const codeParam = searchParams.get("code");
  const [machineCode, setMachineCode] = useState(codeParam || "");
  const [scanning, setScanning] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [remarks, setRemarks] = useState("");
  const [success, setSuccess] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-scanner-container";

  const { data: machine, isLoading, refetch } = useQuery({
    queryKey: ["machine-by-code", machineCode],
    queryFn: async () => {
      if (!machineCode) return null;
      const { data, error } = await supabase
        .from("machine_monitor_machines")
        .select("*")
        .eq("code", machineCode)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Machine | null;
    },
    enabled: !!machineCode,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ machineId, status, remarks }: { machineId: string; status: string; remarks: string }) => {
      const now = new Date().toISOString();
      const { error: logError } = await supabase
        .from("machine_monitor_status_log")
        .insert({ machine_id: machineId, status, remarks: remarks || null, changed_at: now });
      if (logError) throw logError;
      const { error } = await supabase
        .from("machine_monitor_machines")
        .update({ current_status: status, current_status_since: now, current_remarks: remarks || null, updated_at: now })
        .eq("id", machineId);
      if (error) throw error;
    },
    onSuccess: () => {
      setSuccess(true);
      setNewStatus("");
      setRemarks("");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startScanner = async () => {
    setScanning(true);
    try {
      const scanner = new Html5Qrcode(scannerContainerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Extract code from URL or use raw text
          try {
            const url = new URL(decodedText);
            const code = url.searchParams.get("code");
            if (code) {
              setMachineCode(code);
            } else {
              setMachineCode(decodedText);
            }
          } catch {
            setMachineCode(decodedText);
          }
          scanner.stop().catch(() => {});
          setScanning(false);
        },
        () => {} // ignore scan errors
      );
    } catch (err: any) {
      toast.error("Camera access denied or not available");
      setScanning(false);
    }
  };

  const stopScanner = () => {
    scannerRef.current?.stop().catch(() => {});
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  const handleSubmit = () => {
    if (!machine || !newStatus) {
      toast.error("Please select a status");
      return;
    }
    updateMutation.mutate({ machineId: machine.id, status: newStatus, remarks });
  };

  const resetPage = () => {
    setSuccess(false);
    setMachineCode("");
    setNewStatus("");
    setRemarks("");
  };

  // Success screen
  if (success && machine) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Status Updated!</h2>
            <p className="text-muted-foreground text-sm">
              <span className="font-semibold">{machine.name}</span> is now{" "}
              <Badge className={`${STATUS_COLORS[newStatus || machine.current_status] || "bg-muted"} border`}>
                {machine.current_status}
              </Badge>
            </p>
            <Button onClick={resetPage} variant="outline" className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-1" /> Scan Another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Machine found — show update form
  if (machineCode && machine) {
    const colorClass = STATUS_COLORS[machine.current_status] || "bg-muted text-muted-foreground border-border";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{machine.name}</CardTitle>
              <Badge variant="outline" className="text-xs">{machine.code}</Badge>
            </div>
            {machine.department && (
              <p className="text-xs text-muted-foreground">{machine.department}{machine.location ? ` • ${machine.location}` : ""}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Current Status</Label>
              <div className="mt-1">
                <Badge className={`${colorClass} border text-sm px-3 py-1`}>{machine.current_status}</Badge>
              </div>
            </div>

            <div>
              <Label>New Status *</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select new status" />
                </SelectTrigger>
                <SelectContent>
                  {machine.custom_statuses
                    .filter((s) => s !== machine.current_status)
                    .map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional remarks..."
                className="mt-1"
                rows={2}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={resetPage}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={updateMutation.isPending || !newStatus}>
                {updateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...</> : "Update Status"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Machine code provided but not found
  if (machineCode && !isLoading && !machine) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-4">
            <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Machine Not Found</h2>
            <p className="text-sm text-muted-foreground">No active machine with code "<span className="font-mono font-bold">{machineCode}</span>"</p>
            <Button onClick={resetPage} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-1" /> Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Default: Show scanner
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-3">
          <QrCode className="h-10 w-10 mx-auto text-primary mb-2" />
          <CardTitle className="text-lg">Scan Machine QR Code</CardTitle>
          <p className="text-xs text-muted-foreground">Point your camera at a machine QR label to update its status</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div id={scannerContainerId} className="rounded-lg overflow-hidden" />

          {!scanning ? (
            <Button className="w-full" onClick={startScanner}>
              <Camera className="h-4 w-4 mr-2" /> Start Scanner
            </Button>
          ) : (
            <Button className="w-full" variant="outline" onClick={stopScanner}>
              Stop Scanner
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
