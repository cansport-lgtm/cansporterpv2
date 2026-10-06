import { Fuel } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TripFuelAnalysis } from "@/components/trip-fuel/TripFuelAnalysis";

/** Accounting: staff trip fuel with its check against the linked expense account. */
export default function AccountingTripFuelAnalysisPage() {
  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4">
        <PageHeader
          title="Trip Fuel Analysis"
          description="Staff trip fuel paid in cash, set against the ledger account it is linked to."
          icon={Fuel}
          iconColor="bg-amber-600 text-white"
        />
        <TripFuelAnalysis scope="accounting" />
      </div>
    </ERPLayout>
  );
}
