import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialCheckPanel } from "@/components/materials/MaterialCheckPanel";
import {
  fetchLatestCheck,
  hasIssues,
  previewCheck,
  type SourceType,
  summarize,
} from "@/lib/productMaterials";

interface Props {
  sourceType: SourceType;
  sourceId: string;
  orderNumber?: string | null;
  // true while the order is Draft / not approved: shows a live preview.
  // false once confirmed / approved: shows the saved snapshot.
  preview: boolean;
  size?: "sm" | "icon";
}

// "Check stock" button + dialog for an order row.
export function OrderMaterialCheckButton({ sourceType, sourceId, orderNumber, preview, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        title="Check raw-material stock"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <PackageSearch className="h-4 w-4" />
        {size === "sm" && <span className="ml-1">Check stock</span>}
      </Button>
      {open && (
        <OrderMaterialCheckDialog
          open={open}
          onOpenChange={setOpen}
          sourceType={sourceType}
          sourceId={sourceId}
          orderNumber={orderNumber}
          preview={preview}
        />
      )}
    </>
  );
}

function OrderMaterialCheckDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  orderNumber,
  preview,
}: Omit<Props, "size"> & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["material-check", sourceType, sourceId, preview],
    queryFn: async () => {
      if (preview) return { lines: await previewCheck(sourceType, sourceId), saved: null };
      const saved = await fetchLatestCheck(sourceType, sourceId);
      // Confirmed before this feature existed: show live numbers instead.
      if (!saved) return { lines: await previewCheck(sourceType, sourceId), saved: null };
      return { lines: saved.lines, saved: saved.check };
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Raw material check{orderNumber ? ` · ${orderNumber}` : ""}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Checking stock…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <MaterialCheckPanel
            lines={data?.lines ?? []}
            mode={data?.saved ? "saved" : "preview"}
            savedAt={data?.saved?.created_at}
            closedReason={data?.saved?.status === "closed" ? "order closed" : null}
            showPurchaseStatus={!!data?.saved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Red pop-up for the person who just confirmed / approved an order. The check
// already ran inside the database during the save; this only reads it.
export async function toastMaterialCheckResult(
  sourceType: SourceType,
  sourceId: string,
  orderNumber?: string | null,
) {
  try {
    const saved = await fetchLatestCheck(sourceType, sourceId);
    if (!saved || saved.check.status !== "open" || !hasIssues(saved.lines)) return;
    toast.error(`${orderNumber ?? saved.check.order_number ?? "Order"} confirmed — stock warning`, {
      description: `${summarize(saved.lines)}. Store, Purchase and Admin have been notified.`,
      duration: 12000,
      action: {
        label: "Open",
        onClick: () => {
          window.location.assign(`/purchase/material-shortages?check=${saved.check.id}`);
        },
      },
    });
  } catch {
    // The alert itself is already delivered by the database; the pop-up is extra.
  }
}
