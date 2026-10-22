import { PersonGatePassLogPage } from "@/components/person-gate-pass/PersonGatePassLogPage";
import { STAFF_PASS } from "@/lib/personGatePass";

/** Staff gate pass log (SGP-…), HR module: every event on every pass. */
export default function StaffGatePassLogPage() {
  return <PersonGatePassLogPage variant={STAFF_PASS} />;
}
