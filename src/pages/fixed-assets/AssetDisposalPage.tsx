import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Trash2 as TrashIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type DisposalType = "disposed" | "written_off" | "sold";

interface FixedAsset {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  current_value: number;
  status: string;
  disposal_date: string | null;
  disposal_reason: string | null;
  disposal_value: number | null;
  production_departments?: { name: string } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  office_assets: "Office Assets",
  production_machinery: "Production Machinery",
  molds_dies: "Molds & Dies",
  machine_spare_parts: "Machine Spare Parts",
};

const DISPOSAL_TYPE_OPTIONS: { value: DisposalType; label: string }[] = [
  { value: "disposed", label: "Disposed" },
  { value: "written_off", label: "Written Off" },
  { value: "sold", label: "Sold" },
];

export default function AssetDisposalPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [disposalType, setDisposalType] = useState<DisposalType>("disposed");
  const [disposalDate, setDisposalDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [disposalValue, setDisposalValue] = useState<number>(0);
  const [disposalReason, setDisposalReason] = useState("");

  // Fetch active assets
  const { data: activeAssets = [] } = useQuery({
    queryKey: ["fixed-assets-for-disposal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("id, asset_code, name, category, current_value")
        .eq("status", "active")
        .order("asset_code");
      if (error) throw error;
      return data;
    },
  });

  // Fetch disposed assets
  const { data: disposedAssets = [], isLoading } = useQuery({
    queryKey: ["fixed-assets-disposed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*, production_departments(name)")
        .in("status", ["disposed", "written_off", "sold"])
        .order("disposal_date", { ascending: false });
      if (error) throw error;
      return data as FixedAsset[];
    },
  });

  // Disposal mutation
  const disposeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAssetId) throw new Error("Please select an asset");

      const { error } = await supabase
        .from("fixed_assets")
        .update({
          status: disposalType,
          disposal_date: disposalDate,
          disposal_reason: disposalReason || null,
          disposal_value: disposalType === "sold" ? disposalValue : 0,
          current_value: 0, // Set current value to 0 after disposal
        })
        .eq("id", selectedAssetId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets-disposed"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets-for-disposal"] });
      toast.success("Asset disposal recorded successfully");
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleOpenDialog = () => {
    setSelectedAssetId("");
    setDisposalType("disposed");
    setDisposalDate(format(new Date(), "yyyy-MM-dd"));
    setDisposalValue(0);
    setDisposalReason("");
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  const handleSubmit = () => {
    if (!selectedAssetId) {
      toast.error("Please select an asset");
      return;
    }
    if (!disposalReason.trim()) {
      toast.error("Please provide a reason for disposal");
      return;
    }
    disposeMutation.mutate();
  };

  const selectedAsset = activeAssets.find((a) => a.id === selectedAssetId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "disposed":
        return <Badge variant="destructive">Disposed</Badge>;
      case "written_off":
        return <Badge variant="secondary">Written Off</Badge>;
      case "sold":
        return <Badge variant="outline">Sold</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Asset Disposal"
          description="Record disposal, write-off, or sale of assets"
          action={{
            label: "Record Disposal",
            onClick: handleOpenDialog,
            icon: TrashIcon,
          }}
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Disposed</p>
                  <p className="text-2xl font-bold">
                    {disposedAssets.filter((a) => a.status === "disposed").length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Written Off</p>
                  <p className="text-2xl font-bold">
                    {disposedAssets.filter((a) => a.status === "written_off").length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <span className="h-5 w-5 text-green-500 font-bold">₹</span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sold (Value)</p>
                  <p className="text-2xl font-bold">
                    ₹
                    {disposedAssets
                      .filter((a) => a.status === "sold")
                      .reduce((sum, a) => sum + (Number(a.disposal_value) || 0), 0)
                      .toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Disposed Assets Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Disposed Assets History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Disposal Date</TableHead>
                    <TableHead>Asset Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Disposal Value</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : disposedAssets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No disposed assets
                      </TableCell>
                    </TableRow>
                  ) : (
                    disposedAssets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell>
                          {asset.disposal_date
                            ? format(new Date(asset.disposal_date), "dd MMM yyyy")
                            : "-"}
                        </TableCell>
                        <TableCell className="font-mono">{asset.asset_code}</TableCell>
                        <TableCell className="font-medium">{asset.name}</TableCell>
                        <TableCell>{CATEGORY_LABELS[asset.category] || asset.category}</TableCell>
                        <TableCell>{getStatusBadge(asset.status)}</TableCell>
                        <TableCell className="text-right">
                          {asset.status === "sold"
                            ? `₹${Number(asset.disposal_value || 0).toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {asset.disposal_reason || "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Disposal Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Asset Disposal</DialogTitle>
              <DialogDescription>
                Mark an asset as disposed, written off, or sold
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Asset *</Label>
                <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an asset" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAssets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {asset.asset_code} - {asset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAsset && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Category</p>
                      <p className="font-medium">
                        {CATEGORY_LABELS[selectedAsset.category] || selectedAsset.category}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Current Value</p>
                      <p className="font-semibold">
                        ₹{Number(selectedAsset.current_value).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Disposal Type *</Label>
                <Select
                  value={disposalType}
                  onValueChange={(v) => setDisposalType(v as DisposalType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPOSAL_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Disposal Date</Label>
                <Input
                  type="date"
                  value={disposalDate}
                  onChange={(e) => setDisposalDate(e.target.value)}
                />
              </div>

              {disposalType === "sold" && (
                <div className="space-y-2">
                  <Label>Sale Value</Label>
                  <Input
                    type="number"
                    value={disposalValue}
                    onChange={(e) => setDisposalValue(Number(e.target.value))}
                    placeholder="Enter sale amount"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Reason *</Label>
                <Textarea
                  value={disposalReason}
                  onChange={(e) => setDisposalReason(e.target.value)}
                  placeholder="e.g., End of life, Damaged beyond repair, Sold to vendor, etc."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={disposeMutation.isPending}
                variant="destructive"
              >
                Record Disposal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
