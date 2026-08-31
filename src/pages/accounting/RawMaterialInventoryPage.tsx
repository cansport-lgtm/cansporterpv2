import { ERPLayout } from "@/components/layout/ERPLayout";
import { InventoryValuationDashboard } from "@/components/accounting/InventoryValuationDashboard";

export default function RawMaterialInventoryPage() {
  return (
    <ERPLayout>
      <InventoryValuationDashboard variant="rm" />
    </ERPLayout>
  );
}
