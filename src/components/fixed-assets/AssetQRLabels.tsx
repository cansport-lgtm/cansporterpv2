import { useState, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, QrCode } from "lucide-react";

interface Asset {
  id: string;
  asset_code: string;
  name: string;
  category?: string;
  custom_category?: string | null;
  location_description?: string;
}

const enumCategoryLabels: Record<string, string> = {
  office_assets: "Office Assets",
  production_machinery: "Production Machinery",
  molds_dies: "Molds & Dies",
  machine_spare_parts: "Machine Spare Parts",
};

interface AssetQRLabelsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: Asset[];
}

function getDisplayCategory(asset: Asset): string {
  if (asset.custom_category) return asset.custom_category;
  if (asset.category) return enumCategoryLabels[asset.category] || asset.category;
  return "Uncategorized";
}

export function AssetQRLabels({ open, onOpenChange, assets }: AssetQRLabelsProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"select" | "preview">("select");

  // Get unique display categories from assets
  const categories = useMemo(() => {
    const cats = new Set<string>();
    assets.forEach((a) => {
      cats.add(getDisplayCategory(a));
    });
    return Array.from(cats).sort();
  }, [assets]);

  // Filter assets by selected category
  const filteredAssets = useMemo(() => {
    if (selectedCategory === "all") return assets;
    return assets.filter((a) => getDisplayCategory(a) === selectedCategory);
  }, [assets, selectedCategory]);

  // Assets selected for printing
  const printAssets = useMemo(() => {
    return filteredAssets.filter((a) => selectedIds.has(a.id));
  }, [filteredAssets, selectedIds]);

  const toggleAsset = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredAssets.map((a) => a.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val);
    setSelectedIds(new Set());
  };

  const handlePrint = () => {
    const printArea = document.getElementById("qr-labels-print");
    if (!printArea) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Asset QR Labels</title>
      <style>
        body { margin: 0; padding: 10px; font-family: Arial, sans-serif; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .label { border: 1px solid #ccc; padding: 10px; text-align: center; page-break-inside: avoid; border-radius: 4px; }
        .label .code { font-weight: bold; font-size: 13px; margin-top: 6px; font-family: monospace; }
        .label .name { font-size: 11px; color: #555; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; margin-inline: auto; }
        .label .cat { font-size: 9px; color: #888; margin-top: 2px; }
        @media print { .grid { gap: 8px; } .label { border: 1px solid #999; } }
      </style></head><body>${printArea.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setStep("select");
      setSelectedCategory("all");
      setSelectedIds(new Set());
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> Print QR Labels
          </DialogTitle>
          <DialogDescription>
            Select a category and choose which assets to print QR labels for.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            {/* Category Filter */}
            <div className="flex items-end gap-4">
              <div className="flex-1 space-y-1.5">
                <Label>Filter by Category</Label>
                <Select value={selectedCategory} onValueChange={handleCategoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories ({assets.length})</SelectItem>
                    {categories.map((cat) => {
                      const count = assets.filter((a) => getDisplayCategory(a) === cat).length;
                      return (
                        <SelectItem key={cat} value={cat}>
                          {cat} ({count})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Deselect All
                </Button>
              </div>
            </div>

            {/* Asset List with Checkboxes */}
            <div className="border rounded-md max-h-[45vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 w-10 text-center">
                      <Checkbox
                        checked={filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id))}
                        onCheckedChange={(checked) => (checked ? selectAll() : deselectAll())}
                      />
                    </th>
                    <th className="p-2 text-left font-medium">Code</th>
                    <th className="p-2 text-left font-medium">Name</th>
                    <th className="p-2 text-left font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map((asset) => (
                    <tr
                      key={asset.id}
                      className="border-t hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleAsset(asset.id)}
                    >
                      <td className="p-2 text-center">
                        <Checkbox
                          checked={selectedIds.has(asset.id)}
                          onCheckedChange={() => toggleAsset(asset.id)}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{asset.asset_code}</td>
                      <td className="p-2">{asset.name}</td>
                      <td className="p-2 text-muted-foreground text-xs">
                        {getDisplayCategory(asset)}
                      </td>
                    </tr>
                  ))}
                  {filteredAssets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-muted-foreground">
                        No assets found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} of {filteredAssets.length} assets selected
              </span>
              <Button
                onClick={() => setStep("preview")}
                disabled={selectedIds.size === 0}
              >
                Preview Labels ({selectedIds.size})
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep("select")}>
                ← Back to Selection
              </Button>
              <Button size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" /> Print {printAssets.length} Labels
              </Button>
            </div>

            <div id="qr-labels-print">
              <div className="grid grid-cols-3 gap-3">
                {printAssets.map((asset) => (
                  <div key={asset.id} className="border rounded-md p-3 flex flex-col items-center">
                    <QRCodeSVG value={asset.asset_code} size={80} level="M" />
                    <div className="font-mono font-bold text-sm mt-2">{asset.asset_code}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[150px] text-center">
                      {asset.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {getDisplayCategory(asset)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
