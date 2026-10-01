import { PersonGatePassFormPage } from "@/components/person-gate-pass/PersonGatePassFormPage";
import { WORKER_PASS } from "@/lib/personGatePass";

/** Worker gate passes (LGP-…), Labour Productivity module. */
export default function LabourGatePassFormPage() {
  return <PersonGatePassFormPage variant={WORKER_PASS} />;
}
