import { PersonGatePassListPage } from "@/components/person-gate-pass/PersonGatePassListPage";
import { STAFF_SELF_PASS } from "@/lib/personGatePass";

/** Self-service: the logged-in staff member's own company work passes (SGP-…). */
export default function MyGatePassListPage() {
  return <PersonGatePassListPage variant={STAFF_SELF_PASS} />;
}
