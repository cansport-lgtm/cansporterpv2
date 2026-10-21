import AwaitingDispatchBoardBase from "@/components/sales/AwaitingDispatchBoardBase";

export default function DomesticAwaitingDispatchPage() {
  return (
    <AwaitingDispatchBoardBase
      segment="domestic"
      title="Awaiting Dispatch"
      ordersPath="/domestic/orders"
      dispatchPath="/domestic/dispatch"
    />
  );
}
