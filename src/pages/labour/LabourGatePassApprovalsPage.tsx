import { PersonGatePassApprovalsPage } from "@/components/person-gate-pass/PersonGatePassApprovalsPage";
import { WORKER_PASS } from "@/lib/personGatePass";

/** Worker gate passes (LGP-…), Labour Productivity module. */
export default function LabourGatePassApprovalsPage() {
  return <PersonGatePassApprovalsPage variant={WORKER_PASS} />;
}
