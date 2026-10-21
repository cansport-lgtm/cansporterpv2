import AwaitingDispatchBoardBase from "@/components/sales/AwaitingDispatchBoardBase";

export default function ExportAwaitingDispatchPage() {
  return (
    <AwaitingDispatchBoardBase
      segment="export"
      title="Export Awaiting Dispatch"
      ordersPath="/export/orders"
      dispatchPath="/export/dispatch"
    />
  );
}
