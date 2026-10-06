// Advances (labour_advances). Thin wrapper over the shared LabourAdvanceDialog.
import { LabourAdvanceDialog, type LabourAdvanceDialogProps } from "./LabourAdvanceDialog";

export type AdvancePaymentDialogProps = Omit<LabourAdvanceDialogProps, "kind">;

export const AdvancePaymentDialog = (props: AdvancePaymentDialogProps) => <LabourAdvanceDialog kind="advance" {...props} />;
