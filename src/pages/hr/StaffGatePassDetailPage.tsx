import { PersonGatePassDetailPage } from "@/components/person-gate-pass/PersonGatePassDetailPage";
import { STAFF_PASS } from "@/lib/personGatePass";

/** Staff gate passes (SGP-…), HR module. */
export default function StaffGatePassDetailPage() {
  return <PersonGatePassDetailPage variant={STAFF_PASS} />;
}
