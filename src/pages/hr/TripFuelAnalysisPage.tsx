import { Fuel } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { TripFuelAnalysis } from "@/components/trip-fuel/TripFuelAnalysis";

/** HR: staff trip fuel by staff, destination and month. No ledger figures. */
export default function HrTripFuelAnalysisPage() {
  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4">
        <PageHeader
          title="Trip Fuel Analysis"
          description="Official duty trips, kilometres and the fuel money claimed by staff."
          icon={Fuel}
          iconColor="bg-amber-600 text-white"
        />
        <TripFuelAnalysis scope="hr" />
      </div>
    </ERPLayout>
  );
}
