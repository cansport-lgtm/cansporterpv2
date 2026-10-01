import { PersonGatePassDetailPage } from "@/components/person-gate-pass/PersonGatePassDetailPage";
import { WORKER_PASS } from "@/lib/personGatePass";

/** Worker gate passes (LGP-…), Labour Productivity module. */
export default function LabourGatePassDetailPage() {
  return <PersonGatePassDetailPage variant={WORKER_PASS} />;
}
