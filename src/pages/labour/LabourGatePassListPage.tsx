import { PersonGatePassListPage } from "@/components/person-gate-pass/PersonGatePassListPage";
import { WORKER_PASS } from "@/lib/personGatePass";

/** Worker gate passes (LGP-…), Labour Productivity module. */
export default function LabourGatePassListPage() {
  return <PersonGatePassListPage variant={WORKER_PASS} />;
}
