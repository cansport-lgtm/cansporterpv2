import { PersonGatePassListPage } from "@/components/person-gate-pass/PersonGatePassListPage";
import { STAFF_PASS } from "@/lib/personGatePass";

/** Staff gate passes (SGP-…), HR module. */
export default function StaffGatePassListPage() {
  return <PersonGatePassListPage variant={STAFF_PASS} />;
}
