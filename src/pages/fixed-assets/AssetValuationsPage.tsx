import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
import { Plus as PlusIcon, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface AssetValuation {
  id: string;
  asset_id: string;
  valuation_date: string;
  previous_value: number;
  new_value: number;
  reason: string | null;
  created_at: string;
  fixed_assets: {
    asset_code: string;
    name: string;
    current_value: number;
  } | null;
}

export default function AssetValuationsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [newValue, setNewValue] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [valuationDate, setValuationDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Fetch assets for dropdown
  const { data: assets = [] } = useQuery({
    queryKey: ["fixed-assets-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("id, asset_code, name, current_value")
        .eq("status", "active")
        .order("asset_code");
      if (error) throw error;
      return data;
    },
  });

  // Fetch valuations
  const { data: valuations = [], isLoading } = useQuery({
    queryKey: ["asset-valuations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_valuations")
        .select("*, fixed_assets(asset_code, name, current_value)")
        .order("valuation_date", { ascending: false });
      if (error) throw error;
      return data as AssetValuation[];
    },
  });

  // Create valuation mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const selectedAsset = assets.find((a) => a.id === selectedAssetId);
      if (!selectedAsset) throw new Error("Please select an asset");

      // Insert valuation record
      const { error: valError } = await supabase.from("asset_valuations").insert({
        asset_id: selectedAssetId,
        valuation_date: valuationDate,
        previous_value: selectedAsset.current_value,
        new_value: newValue,
        reason: reason || null,
        valued_by: user?.id || null,
      });
      if (valError) throw valError;

      // Update asset's current value
      const { error: updateError } = await supabase
        .from("fixed_assets")
        .update({
          current_value: newValue,
          last_valuation_date: valuationDate,
        })
        .eq("id", selectedAssetId);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-valuations"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      queryClient.invalidateQueries({ queryKey: ["fixed-assets-active"] });
      toast.success("Valuation recorded successfully");
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleOpenDialog = () => {
    setSelectedAssetId("");
    setNewValue(0);
    setReason("");
    setValuationDate(format(new Date(), "yyyy-MM-dd"));
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedAssetId("");
    setNewValue(0);
    setReason("");
  };

  const handleAssetChange = (assetId: string) => {
    setSelectedAssetId(assetId);
    const asset = assets.find((a) => a.id === assetId);
    if (asset) {
      setNewValue(Number(asset.current_value));
    }
  };

  const handleSubmit = () => {
    if (!selectedAssetId) {
      toast.error("Please select an asset");
      return;
    }
    createMutation.mutate();
  };

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  const valueDiff = selectedAsset ? newValue - Number(selectedAsset.current_value) : 0;

  return (
    <ERPLayout>
      <div className="space-y-4 md:space-y-6">
        <PageHeader
          title="Asset Valuations"
          description="Record and track asset value changes over time"
          action={{
            label: "New Valuation",
            onClick: handleOpenDialog,
            icon: PlusIcon,
          }}
        />

        {/* Valuations Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[100px]">Date</TableHead>
                    <TableHead className="min-w-[100px]">Asset Code</TableHead>
                    <TableHead className="min-w-[120px] hidden sm:table-cell">Asset Name</TableHead>
                    <TableHead className="text-right min-w-[100px] hidden md:table-cell">Previous Value</TableHead>
                    <TableHead className="text-right min-w-[100px]">New Value</TableHead>
                    <TableHead className="text-right min-w-[100px]">Change</TableHead>
                    <TableHead className="hidden lg:table-cell">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : valuations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No valuations recorded yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    valuations.map((val) => {
                      const change = Number(val.new_value) - Number(val.previous_value);
                      return (
                        <TableRow key={val.id}>
                          <TableCell className="whitespace-nowrap">{format(new Date(val.valuation_date), "dd MMM yyyy")}</TableCell>
                          <TableCell className="font-mono text-xs sm:text-sm">{val.fixed_assets?.asset_code}</TableCell>
                          <TableCell className="hidden sm:table-cell">{val.fixed_assets?.name}</TableCell>
                          <TableCell className="text-right hidden md:table-cell">
                            ₹{Number(val.previous_value).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-semibold whitespace-nowrap">
                            ₹{Number(val.new_value).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {change > 0 ? (
                                <TrendingUp className="h-4 w-4 text-green-500 shrink-0" />
                              ) : change < 0 ? (
                                <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
                              ) : (
                                <Minus className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <span
                                className={`whitespace-nowrap text-xs sm:text-sm ${
                                  change > 0
                                    ? "text-green-600"
                                    : change < 0
                                    ? "text-red-600"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {change >= 0 ? "+" : ""}₹{change.toLocaleString()}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate hidden lg:table-cell">
                            {val.reason || "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* New Valuation Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Record New Valuation</DialogTitle>
              <DialogDescription>
                Update the current value of an asset and record the change
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Asset *</Label>
                <Select value={selectedAssetId} onValueChange={handleAssetChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an asset" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {assets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        <span className="truncate">{asset.asset_code} - {asset.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAsset && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">Current Value</p>
                  <p className="text-lg font-semibold">
                    ₹{Number(selectedAsset.current_value).toLocaleString()}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Valuation Date</Label>
                <Input
                  type="date"
                  value={valuationDate}
                  onChange={(e) => setValuationDate(e.target.value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label>New Value *</Label>
                <Input
                  type="number"
                  value={newValue}
                  onChange={(e) => setNewValue(Number(e.target.value))}
                  placeholder="Enter new value"
                  className="w-full"
                />
              </div>

              {selectedAsset && valueDiff !== 0 && (
                <div
                  className={`p-3 rounded-lg ${
                    valueDiff > 0 ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"
                  }`}
                >
                  <p className="text-sm">Value Change</p>
                  <p className="text-lg font-semibold">
                    {valueDiff >= 0 ? "+" : ""}₹{valueDiff.toLocaleString()}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Annual depreciation, Market revaluation, etc."
                  rows={3}
                  className="w-full resize-none"
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleCloseDialog} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending} className="w-full sm:w-auto">
                Record Valuation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
