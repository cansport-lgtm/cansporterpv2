import { PersonGatePassApprovalsPage } from "@/components/person-gate-pass/PersonGatePassApprovalsPage";
import { STAFF_PASS } from "@/lib/personGatePass";

/** Staff gate passes (SGP-…), HR module. */
export default function StaffGatePassApprovalsPage() {
  return <PersonGatePassApprovalsPage variant={STAFF_PASS} />;
}
