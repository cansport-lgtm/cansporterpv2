import { useState, useRef } from "react";
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
import { BookOpen, Download, Filter, Printer, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface LedgerEntry {
  id: string;
  ledger_date: string;
  item_name: string;
  location_id: string | null;
  transaction_type: string;
  quantity_in: number;
  quantity_out: number;
  balance_quantity: number;
  unit: string | null;
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
];

export default function FloorInventoryLedgerPage() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [filterItem, setFilterItem] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const printRef = useRef<HTMLDivElement>(null);

  const { data: ledgerEntries = [], refetch } = useQuery({
    queryKey: ["floor-inventory-ledger", dateFrom, dateTo, filterItem, filterLocation],
    queryFn: async () => {
      let query = supabase
        .from("floor_inventory_ledger")
        .select("*")
        .gte("ledger_date", dateFrom)
        .lte("ledger_date", dateTo)
        .order("ledger_date", { ascending: true })
        .order("created_at", { ascending: true });

      if (filterItem !== "all") {
        query = query.eq("item_name", filterItem);
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
    queryKey: ["floor-inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: stockItems = [] } = useQuery({
    queryKey: ["floor-inventory-ledger-item-names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("item_name")
        .order("item_name");
      if (error) throw error;
      // Get unique item names as strings
      const uniqueItems = [...new Set(data.map((item: any) => item.item_name))] as string[];
      return uniqueItems;
    },
  });

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
    }),
    { totalIn: 0, totalOut: 0 }
  );

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
      key: "item_name",
      header: "Item",
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
      key: "unit",
      header: "Unit",
    },
    { key: "reference_number", header: "Reference" },
  ];

  const handleExport = () => {
    const headers = ["Date", "Transaction", "Item", "Location", "Qty In", "Qty Out", "Balance", "Unit", "Reference"];
    const rows = ledgerEntries.map((entry) => [
      format(new Date(entry.ledger_date), "dd/MM/yyyy"),
      TRANSACTION_TYPES.find((t) => t.value === entry.transaction_type)?.label || entry.transaction_type,
      entry.item_name,
      getLocationName(entry.location_id),
      entry.quantity_in,
      entry.quantity_out,
      entry.balance_quantity,
      entry.unit || "",
      entry.reference_number || "",
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floor-inventory-ledger-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const itemLabel = filterItem === "all" ? "All Items" : filterItem;
    const locationLabel = filterLocation === "all" ? "All Locations" : getLocationName(filterLocation);

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Floor Inventory Ledger</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 11px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .header h1 { font-size: 18px; margin-bottom: 5px; }
          .header p { font-size: 12px; color: #666; }
          .filters { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 10px; }
          .filters span { background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          th { background: #f5f5f5; font-weight: bold; font-size: 10px; }
          td { font-size: 10px; }
          .qty-in { color: #16a34a; font-weight: 600; }
          .qty-out { color: #dc2626; font-weight: 600; }
          .balance { font-weight: 700; }
          .summary { display: flex; gap: 30px; justify-content: center; margin-top: 20px; padding-top: 15px; border-top: 2px solid #333; }
          .summary-item { text-align: center; }
          .summary-item .label { font-size: 10px; color: #666; }
          .summary-item .value { font-size: 16px; font-weight: bold; }
          .summary-item .value.positive { color: #16a34a; }
          .summary-item .value.negative { color: #dc2626; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>FLOOR INVENTORY LEDGER</h1>
          <p>Period: ${format(new Date(dateFrom), "dd MMM yyyy")} to ${format(new Date(dateTo), "dd MMM yyyy")}</p>
        </div>
        <div class="filters">
          <span><strong>Item:</strong> ${itemLabel}</span>
          <span><strong>Location:</strong> ${locationLabel}</span>
          <span><strong>Entries:</strong> ${ledgerEntries.length}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Transaction</th>
              <th>Item</th>
              <th>Location</th>
              <th>Qty In</th>
              <th>Qty Out</th>
              <th>Balance</th>
              <th>Unit</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerEntries.map(entry => `
              <tr>
                <td>${format(new Date(entry.ledger_date), "dd MMM yyyy")}</td>
                <td>${TRANSACTION_TYPES.find(t => t.value === entry.transaction_type)?.label || entry.transaction_type}</td>
                <td>${entry.item_name}</td>
                <td>${getLocationName(entry.location_id)}</td>
                <td class="qty-in">${entry.quantity_in > 0 ? '+' + entry.quantity_in.toLocaleString() : '-'}</td>
                <td class="qty-out">${entry.quantity_out > 0 ? '-' + entry.quantity_out.toLocaleString() : '-'}</td>
                <td class="balance">${entry.balance_quantity.toLocaleString()}</td>
                <td>${entry.unit || '-'}</td>
                <td>${entry.reference_number || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="summary">
          <div class="summary-item">
            <div class="label">Total Qty In</div>
            <div class="value positive">+${totals.totalIn.toLocaleString()}</div>
          </div>
          <div class="summary-item">
            <div class="label">Total Qty Out</div>
            <div class="value negative">-${totals.totalOut.toLocaleString()}</div>
          </div>
          <div class="summary-item">
            <div class="label">Net Change</div>
            <div class="value ${totals.totalIn - totals.totalOut >= 0 ? 'positive' : 'negative'}">
              ${totals.totalIn - totals.totalOut >= 0 ? '+' : ''}${(totals.totalIn - totals.totalOut).toLocaleString()}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Inventory Ledger"
        description="Transaction history for floor inventory items"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
              <Label>Item</Label>
              <Select value={filterItem} onValueChange={setFilterItem}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Items</SelectItem>
                  {stockItems.map((itemName: string) => (
                    <SelectItem key={itemName} value={itemName}>
                      {itemName}
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
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
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
            <p className="text-sm text-muted-foreground">Net Change</p>
            <p className={`text-2xl font-bold ${totals.totalIn - totals.totalOut >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {totals.totalIn - totals.totalOut >= 0 ? '+' : ''}{(totals.totalIn - totals.totalOut).toLocaleString()}
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
                  <div className="font-medium text-sm truncate">{entry.item_name}</div>
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
                  <div className="font-semibold">{entry.balance_quantity.toLocaleString()} {entry.unit || ""}</div>
                </div>
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
