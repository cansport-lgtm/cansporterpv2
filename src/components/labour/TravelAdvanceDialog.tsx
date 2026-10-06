// Travel advances (labour_travel_advances). Thin wrapper over the shared LabourAdvanceDialog.
import { LabourAdvanceDialog, type LabourAdvanceDialogProps } from "./LabourAdvanceDialog";

export type TravelAdvanceDialogProps = Omit<LabourAdvanceDialogProps, "kind">;

export const TravelAdvanceDialog = (props: TravelAdvanceDialogProps) => <LabourAdvanceDialog kind="travel" {...props} />;
