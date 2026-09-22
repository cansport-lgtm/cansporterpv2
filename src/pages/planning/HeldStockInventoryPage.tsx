import { ERPLayout } from "@/components/layout/ERPLayout";
import { InventoryValuationDashboard } from "@/components/accounting/InventoryValuationDashboard";

/**
 * Production Planning view of the Finished Goods Inventory report, limited to
 * held stock — CPA, Leak and Rejection. Standard sellable stock is hidden.
 */
export default function HeldStockInventoryPage() {
  return (
    <ERPLayout>
      <InventoryValuationDashboard variant="fg" heldOnly />
    </ERPLayout>
  );
}
