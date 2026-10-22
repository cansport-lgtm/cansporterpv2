import { PersonGatePassLogPage } from "@/components/person-gate-pass/PersonGatePassLogPage";
import { WORKER_PASS } from "@/lib/personGatePass";

/** Worker gate pass log (LGP-…), Labour Productivity module: every event on every pass. */
export default function LabourGatePassLogPage() {
  return <PersonGatePassLogPage variant={WORKER_PASS} />;
}
