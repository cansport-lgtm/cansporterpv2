import { PersonGatePassFormPage } from "@/components/person-gate-pass/PersonGatePassFormPage";
import { STAFF_SELF_PASS } from "@/lib/personGatePass";

/** Self-service: the logged-in staff member's own company work passes (SGP-…). */
export default function MyGatePassFormPage() {
  return <PersonGatePassFormPage variant={STAFF_SELF_PASS} />;
}
