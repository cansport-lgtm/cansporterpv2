import { PersonGatePassFormPage } from "@/components/person-gate-pass/PersonGatePassFormPage";
import { STAFF_PASS } from "@/lib/personGatePass";

/** Staff gate passes (SGP-…), HR module. */
export default function StaffGatePassFormPage() {
  return <PersonGatePassFormPage variant={STAFF_PASS} />;
}
