import AwaitingDispatchBoardBase from "@/components/sales/AwaitingDispatchBoardBase";

export default function AwaitingDispatchPage() {
  return (
    <AwaitingDispatchBoardBase
      segment="private_label"
      title="Awaiting Dispatch"
      ordersPath="/sales/orders"
      dispatchPath="/sales/dispatch"
    />
  );
}
