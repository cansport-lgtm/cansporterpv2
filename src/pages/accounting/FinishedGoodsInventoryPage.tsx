import { ERPLayout } from "@/components/layout/ERPLayout";
import { InventoryValuationDashboard } from "@/components/accounting/InventoryValuationDashboard";

export default function FinishedGoodsInventoryPage() {
  return (
    <ERPLayout>
      <InventoryValuationDashboard variant="fg" />
    </ERPLayout>
  );
}
