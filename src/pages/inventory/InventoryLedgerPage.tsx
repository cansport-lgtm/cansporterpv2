import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BookOpen, Download, Filter, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface LedgerEntry {
  id: string;
  ledger_date: string;
  item_type: string;
  item_id: string;
  location_id: string | null;
  transaction_type: string;
  quantity_in: number;
  quantity_out: number;
  balance_quantity: number;
  unit_cost: number;
  value_in: number;
  value_out: number;
  balance_value: number;
  reference_number: string | null;
  remarks: string | null;
  created_at: string;
}

const TRANSACTION_TYPES = [
  { value: "opening", label: "Opening Balance" },
  { value: "receipt", label: "Receipt" },
  { value: "issue", label: "Issue" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "adjustment", label: "Adjustment" },
  { value: "closing", label: "Closing Balance" },
];

const ITEM_TYPES = [
  { value: "raw_material", label: "Raw Material" },
  { value: "finished_goods", label: "Finished Goods" },
  { value: "consumable", label: "Consumable" },
];

export default function InventoryLedgerPage() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [filterItemType, setFilterItemType] = useState<string>("all");
  const [filterItem, setFilterItem] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");

  const { data: ledgerEntries = [], refetch } = useQuery({
    queryKey: ["inventory-ledger", dateFrom, dateTo, filterItemType, filterItem, filterLocation],
    queryFn: async () => {
      let query = supabase
        .from("inventory_ledger")
        .select("*")
        .gte("ledger_date", dateFrom)
        .lte("ledger_date", dateTo)
        .order("ledger_date", { ascending: true })
        .order("created_at", { ascending: true });

      if (filterItemType !== "all") {
        query = query.eq("item_type", filterItemType);
      }
      if (filterItem !== "all") {
        query = query.eq("item_id", filterItem);
      }
      if (filterLocation !== "all") {
        query = query.eq("location_id", filterLocation);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LedgerEntry[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const getItemName = (entry: LedgerEntry) => {
    if (entry.item_type === "finished_goods") {
      const product = products.find((p: any) => p.id === entry.item_id);
      return product?.name || entry.item_id;
    }
    const item = items.find((i: any) => i.id === entry.item_id);
    return item?.name || entry.item_id;
  };

  const getLocationName = (locationId: string | null) => {
    if (!locationId) return "-";
    const location = locations.find((l: any) => l.id === locationId);
    return location?.name || locationId;
  };

  // Calculate totals
  const totals = ledgerEntries.reduce(
    (acc, entry) => ({
      totalIn: acc.totalIn + Number(entry.quantity_in || 0),
      totalOut: acc.totalOut + Number(entry.quantity_out || 0),
      valueIn: acc.valueIn + Number(entry.value_in || 0),
      valueOut: acc.valueOut + Number(entry.value_out || 0),
    }),
    { totalIn: 0, totalOut: 0, valueIn: 0, valueOut: 0 }
  );

  // Get available items based on selected item type
  const availableItems =
    filterItemType === "finished_goods"
      ? products
      : filterItemType === "all"
      ? [...items, ...products]
      : items;

  const columns = [
    {
      key: "ledger_date",
      header: "Date",
      render: (item: LedgerEntry) => format(new Date(item.ledger_date), "dd MMM yyyy"),
    },
    {
      key: "transaction_type",
      header: "Transaction",
      render: (item: LedgerEntry) =>
        TRANSACTION_TYPES.find((t) => t.value === item.transaction_type)?.label || item.transaction_type,
    },
    {
      key: "item_id",
      header: "Item",
      render: (row: LedgerEntry) => getItemName(row),
    },
    {
      key: "location_id",
      header: "Location",
      render: (item: LedgerEntry) => getLocationName(item.location_id),
    },
    {
      key: "quantity_in",
      header: "Qty In",
      render: (item: LedgerEntry) =>
        item.quantity_in > 0 ? (
          <span className="text-primary font-medium">+{item.quantity_in.toLocaleString()}</span>
        ) : (
          "-"
        ),
    },
    {
      key: "quantity_out",
      header: "Qty Out",
      render: (item: LedgerEntry) =>
        item.quantity_out > 0 ? (
          <span className="text-destructive font-medium">-{item.quantity_out.toLocaleString()}</span>
        ) : (
          "-"
        ),
    },
    {
      key: "balance_quantity",
      header: "Balance",
      render: (item: LedgerEntry) => (
        <span className="font-semibold">{item.balance_quantity.toLocaleString()}</span>
      ),
    },
    {
      key: "unit_cost",
      header: "Rate",
      render: (item: LedgerEntry) => `₹${item.unit_cost.toFixed(2)}`,
    },
    {
      key: "balance_value",
      header: "Value",
      render: (item: LedgerEntry) => `₹${item.balance_value.toLocaleString()}`,
    },
    { key: "reference_number", header: "Reference" },
  ];

  const handleExport = () => {
    const headers = ["Date", "Transaction", "Item", "Location", "Qty In", "Qty Out", "Balance", "Rate", "Value", "Reference"];
    const rows = ledgerEntries.map((entry) => [
      format(new Date(entry.ledger_date), "dd/MM/yyyy"),
      TRANSACTION_TYPES.find((t) => t.value === entry.transaction_type)?.label || entry.transaction_type,
      getItemName(entry),
      getLocationName(entry.location_id),
      entry.quantity_in,
      entry.quantity_out,
      entry.balance_quantity,
      entry.unit_cost,
      entry.balance_value,
      entry.reference_number || "",
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-ledger-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Inventory Ledger"
        description="Detailed transaction history for all inventory items"
        icon={BookOpen}
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Item Type</Label>
              <Select value={filterItemType} onValueChange={(v) => {
                setFilterItemType(v);
                setFilterItem("all");
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {ITEM_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Item</Label>
              <Select value={filterItem} onValueChange={setFilterItem}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Items</SelectItem>
                  {availableItems.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={filterLocation} onValueChange={setFilterLocation}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Qty In</p>
            <p className="text-2xl font-bold text-primary">
              +{totals.totalIn.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Qty Out</p>
            <p className="text-2xl font-bold text-destructive">
              -{totals.totalOut.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Value In</p>
            <p className="text-2xl font-bold text-primary">
              ₹{totals.valueIn.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Value Out</p>
            <p className="text-2xl font-bold text-destructive">
              ₹{totals.valueOut.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} data={ledgerEntries} />
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {ledgerEntries.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8 border rounded-lg bg-card">No data available</div>
        ) : (
          ledgerEntries.map((entry) => (
            <div key={entry.id} className="border rounded-lg p-3 space-y-2 bg-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{getItemName(entry)}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(entry.ledger_date), "dd MMM yyyy")} · {getLocationName(entry.location_id)}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {TRANSACTION_TYPES.find((t) => t.value === entry.transaction_type)?.label || entry.transaction_type}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
                <div>
                  <div className="text-muted-foreground">Qty In</div>
                  <div className="text-primary font-medium">{entry.quantity_in > 0 ? `+${entry.quantity_in.toLocaleString()}` : "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Qty Out</div>
                  <div className="text-destructive font-medium">{entry.quantity_out > 0 ? `-${entry.quantity_out.toLocaleString()}` : "-"}</div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Balance</div>
                  <div className="font-semibold">{entry.balance_quantity.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Rate: ₹{entry.unit_cost.toFixed(2)}</span>
                <span>Value: ₹{entry.balance_value.toLocaleString()}</span>
              </div>
              {entry.reference_number && (
                <div className="text-xs text-muted-foreground">Ref: {entry.reference_number}</div>
              )}
            </div>
          ))
        )}
      </div>
    </ERPLayout>
  );
}
