import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { VoucherViewDialog } from "@/components/accounting/VoucherViewDialog";
import { ArrowLeft } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";

const sb = supabase as any;

export default function GeneralLedgerPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchParams] = useSearchParams();
  const [viewVoucherId, setViewVoucherId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Arrived here by drilling down (e.g. clicking an expense in Profit & Loss).
  const isDrillDown = !!searchParams.get("account");

  // Escape returns to the previous page (the statement we drilled in from, such
  // as Profit & Loss). Skipped while an overlay is open — the voucher dialog and
  // the account/search popovers handle their own Escape to close first.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (viewVoucherId) return;
      // Don't hijack Escape while a field is focused (e.g. date inputs) or while
      // an overlay (voucher dialog, account/search popover, select) is open —
      // those handle Escape themselves first.
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')) return;
      navigate(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, viewVoucherId]);

  const { data: accounts } = useQuery({
    queryKey: ["acc-gl-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category")
        .eq("is_active", true)
        .not("sub_category", "is", null)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const filteredAccountsList = useMemo(() => {
    const list = accounts || [];
    return filterType === "all" ? list : list.filter((a: any) => a.account_type === filterType);
  }, [accounts, filterType]);

  // Deep link: preselect an account from ?account=<id> (e.g. drill-down from Profit & Loss)
  useEffect(() => {
    const acc = searchParams.get("account");
    if (acc) setAccountId(acc);
  }, [searchParams]);

  useEffect(() => {
    // Don't auto-select the first account when a ?account= deep link is present —
    // otherwise this effect can override the linked account on initial mount.
    if (searchParams.get("account")) return;
    if (!accountId && filteredAccountsList?.length) setAccountId(filteredAccountsList[0].id);
  }, [filteredAccountsList, accountId, searchParams]);

  const { data: opening } = useQuery({
    queryKey: ["acc-gl-opening", accountId, fromDate],
    queryFn: async () => {
      if (!accountId) return 0;
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
          .eq("account_id", accountId)
          .lt("voucher.voucher_date", fromDate)
          .order("id", { ascending: true })
          .range(from, to));
      return (data || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0) - Number(l.credit_amount || 0), 0);
    },
    enabled: !!accountId,
  });

  const { data: lines } = useQuery({
    queryKey: ["acc-gl-lines", accountId, fromDate, toDate],
    queryFn: async () => {
      if (!accountId) return [];
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("*, voucher:accounting_vouchers!inner(voucher_number, voucher_type, voucher_date, narration), party:accounting_parties(name)")
          .eq("account_id", accountId)
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to));
      return (data || []).sort((a: any, b: any) => {
        const ad = a.voucher?.voucher_date || "";
        const bd = b.voucher?.voucher_date || "";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.voucher?.voucher_number || "").localeCompare(b.voucher?.voucher_number || "");
      });
    },
    enabled: !!accountId,
  });

  const voucherIds = useMemo(() => Array.from(new Set((lines || []).map((l: any) => l.voucher_id))), [lines]);
  const { data: contraData } = useQuery({
    queryKey: ["acc-gl-contra", voucherIds.join(",")],
    queryFn: async () => {
      if (!voucherIds.length) return {};
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, account_id, account:accounting_chart_of_accounts(name)")
          .in("voucher_id", voucherIds)
          .order("id", { ascending: true })
          .range(from, to));
      const map: Record<string, string> = {};
      (data || []).forEach((l: any) => {
        if (l.account_id === accountId) return;
        if (!map[l.voucher_id]) map[l.voucher_id] = l.account?.name || "";
        else if (!map[l.voucher_id].includes(l.account?.name)) map[l.voucher_id] += ", " + l.account?.name;
      });
      return map;
    },
    enabled: voucherIds.length > 0,
  });

  const selected = (accounts || []).find((a: any) => a.id === accountId);
  // Asset/Expense: Dr increases; Liability/Equity/Revenue: Cr increases. Display sign convention:
  const isDrNormal = selected ? ["asset", "expense"].includes(selected.account_type) : true;

  const rows = useMemo(() => {
    if (!lines) return [];
    let bal = Number(opening || 0);
    return lines.map((l: any) => {
      bal += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      return { ...l, runningBalance: bal };
    });
  }, [lines, opening]);

  const totalDr = (lines || []).reduce((s: number, l: any) => s + Number(l.debit_amount || 0), 0);
  const totalCr = (lines || []).reduce((s: number, l: any) => s + Number(l.credit_amount || 0), 0);
  const closing = Number(opening || 0) + totalDr - totalCr;
  // For display, negative balance flipped for Cr-normal accounts:
  const displayBalance = isDrNormal ? closing : -closing;

  return (
    <ERPLayout>
      <PageHeader title="General Ledger" description="Drill into any account's transactions">
        <div className="flex gap-2">
          {isDrillDown && (
            <Button size="sm" variant="outline" onClick={() => navigate(-1)} title="Back (Esc)">
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
          )}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="asset">Asset</SelectItem>
              <SelectItem value="liability">Liability</SelectItem>
              <SelectItem value="equity">Equity</SelectItem>
              <SelectItem value="revenue">Revenue</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
            </SelectContent>
          </Select>
          <SearchableSelect
            value={accountId}
            onValueChange={setAccountId}
            options={(filteredAccountsList || []).map((a: any) => ({ value: a.id, label: `${a.code} — ${a.name}`, search: a.name }))}
            placeholder="Account"
            triggerClassName="w-[320px]"
          />
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[150px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[150px]" />
        </div>
      </PageHeader>

      {selected && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Account</div><div className="text-sm font-semibold">{selected.code} — {selected.name}</div><div className="text-xs text-muted-foreground capitalize">{selected.account_type}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Opening (Dr−Cr)</div><div className="text-xl font-semibold">Rs. {Number(opening || 0).toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Period Movement</div><div className="text-xs text-green-600">Dr: Rs. {totalDr.toLocaleString()}</div><div className="text-xs text-red-600">Cr: Rs. {totalCr.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Closing</div><div className="text-xl font-semibold">Rs. {displayBalance.toLocaleString()} <span className="text-xs text-muted-foreground">{isDrNormal ? "Dr" : "Cr"}</span></div></CardContent></Card>
        </div>
      )}

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Contra A/c</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell colSpan={7} className="text-xs italic">Opening Balance</TableCell>
              <TableCell className="text-right font-semibold">Rs. {Number(opening || 0).toLocaleString()}</TableCell>
            </TableRow>
            {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No transactions in this range</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.voucher?.voucher_date && format(parseISO(r.voucher.voucher_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="font-mono text-[10px] mr-1">{r.voucher?.voucher_type}</Badge>
                  <button
                    type="button"
                    onClick={() => setViewVoucherId(r.voucher_id)}
                    className="text-primary hover:underline"
                    title="Open voucher"
                  >
                    {r.voucher?.voucher_number}
                  </button>
                </TableCell>
                <TableCell className="text-xs">{contraData?.[r.voucher_id] || "—"}</TableCell>
                <TableCell className="text-xs">{r.party?.name || "—"}</TableCell>
                <TableCell className="text-xs max-w-[260px] truncate">{r.line_narration || r.voucher?.narration || "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.debit_amount) > 0 ? `Rs. ${Number(r.debit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.credit_amount) > 0 ? `Rs. ${Number(r.credit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.runningBalance.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={5}>Period Total / Closing</TableCell>
              <TableCell className="text-right">Rs. {totalDr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {totalCr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {closing.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <VoucherViewDialog voucherId={viewVoucherId} onOpenChange={(o) => !o && setViewVoucherId(null)} />
    </ERPLayout>
  );
}
