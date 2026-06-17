import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ArrowDownCircle, ArrowUpCircle, Zap, Pencil } from "lucide-react";
import { VoucherViewDialog } from "@/components/accounting/VoucherViewDialog";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays, parseISO } from "date-fns";

const sb = supabase as any;

type QEMode = "receipt" | "payment";

export default function CashBookPage() {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState<string>("");
  const [viewVoucherId, setViewVoucherId] = useState<string | null>(null);

  // ----- Edit-voucher state (super admin only; manual cash vouchers) -----
  const [editVoucherId, setEditVoucherId] = useState<string | null>(null);
  const [edMode, setEdMode] = useState<QEMode>("receipt");
  const [edDate, setEdDate] = useState("");
  const [edContraId, setEdContraId] = useState<string>("");
  const [edPartyId, setEdPartyId] = useState<string>("none");
  const [edAmount, setEdAmount] = useState<string>("");
  const [edNote, setEdNote] = useState<string>("");

  // ----- Quick-entry state -----
  const [qeMode, setQeMode] = useState<QEMode>("receipt");
  const [qeDate, setQeDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [qeContraId, setQeContraId] = useState<string>("");
  const [qePartyId, setQePartyId] = useState<string>("none");
  const [qeAmount, setQeAmount] = useState<string>("");
  const [qeNote, setQeNote] = useState<string>("");
  const amountRef = useRef<HTMLInputElement>(null);

  const { data: cashAccounts } = useQuery({
    queryKey: ["acc-cashbook-accounts"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name")
        .eq("is_cash_account", true)
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!accountId && cashAccounts?.length) setAccountId(cashAccounts[0].id);
  }, [cashAccounts, accountId]);

  // Postable accounts for the "other side" of the entry (excludes the cash account itself)
  const { data: postableAccounts } = useQuery({
    queryKey: ["acc-cashbook-postable"],
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

  const { data: parties } = useQuery({
    queryKey: ["acc-cashbook-parties"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_parties")
        .select("id, name, party_type")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const otherSideAccounts = useMemo(
    () => (postableAccounts || []).filter((a: any) => a.id !== accountId),
    [postableAccounts, accountId]
  );

  // Default account slots — used to detect when the user picked AR or AP as the contra,
  // so the party dropdown can auto-filter to the relevant party type.
  const { data: defaultAccountSlots } = useQuery({
    queryKey: ["acc-cashbook-default-slots"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_default_accounts")
        .select("key, account_id")
        .in("key", ["accounts_receivable", "accounts_payable"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { if (r.account_id) map[r.key] = r.account_id; });
      return map;
    },
  });

  // Decide which party_type (if any) to restrict the dropdown to, based on contra.
  const partyTypeFilter: "customer" | "supplier" | null = useMemo(() => {
    if (!qeContraId || !defaultAccountSlots) return null;
    if (qeContraId === defaultAccountSlots.accounts_receivable) return "customer";
    if (qeContraId === defaultAccountSlots.accounts_payable) return "supplier";
    return null;
  }, [qeContraId, defaultAccountSlots]);

  const filteredParties = useMemo(() => {
    if (!parties) return [];
    if (!partyTypeFilter) return parties;
    return parties.filter((p: any) => p.party_type === partyTypeFilter);
  }, [parties, partyTypeFilter]);

  // If the currently selected party doesn't match the new filter, clear it.
  useEffect(() => {
    if (qePartyId === "none") return;
    if (!partyTypeFilter || !parties) return;
    const ok = parties.some((p: any) => p.id === qePartyId && p.party_type === partyTypeFilter);
    if (!ok) setQePartyId("none");
  }, [partyTypeFilter, parties, qePartyId]);

  const resetQuickEntry = () => {
    setQeContraId("");
    setQePartyId("none");
    setQeAmount("");
    setQeNote("");
    // keep qeMode + qeDate to allow rapid repeat entry
  };

  const quickPostMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(qeAmount);
      if (!accountId) throw new Error("Select a cash account");
      if (!qeContraId) throw new Error("Select the other-side account");
      if (qeContraId === accountId) throw new Error("Other-side account cannot be the cash account itself");
      if (!(amount > 0)) throw new Error("Amount must be greater than zero");
      if (!qeDate) throw new Error("Date is required");

      const isReceipt = qeMode === "receipt";
      const voucherType = isReceipt ? "CRV" : "CPV";

      const { data: voucher, error: vErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: voucherType,
          voucher_date: qeDate,
          party_id: qePartyId === "none" ? null : qePartyId,
          narration: qeNote,
          total_amount: amount,
          status: "posted",
          source_module: "manual",
        })
        .select()
        .single();
      if (vErr) throw vErr;

      const linesPayload = [
        {
          voucher_id: voucher.id,
          account_id: accountId,
          party_id: null,
          debit_amount: isReceipt ? amount : 0,
          credit_amount: isReceipt ? 0 : amount,
          line_narration: isReceipt ? "Received" : "Paid",
          line_order: 0,
        },
        {
          voucher_id: voucher.id,
          account_id: qeContraId,
          party_id: qePartyId === "none" ? null : qePartyId,
          debit_amount: isReceipt ? 0 : amount,
          credit_amount: isReceipt ? amount : 0,
          line_narration: qeNote || "",
          line_order: 1,
        },
      ];
      const { error: lErr } = await sb.from("accounting_voucher_lines").insert(linesPayload);
      if (lErr) throw lErr;

      return voucher;
    },
    onSuccess: (voucher: any) => {
      toast({ title: `${voucher.voucher_type} posted`, description: voucher.voucher_number });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-opening"] });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-contra"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-recent"] });
      resetQuickEntry();
      amountRef.current?.focus();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !quickPostMutation.isPending) {
      e.preventDefault();
      quickPostMutation.mutate();
    }
  };

  // Opening balance: sum of lines BEFORE fromDate
  const { data: opening } = useQuery({
    queryKey: ["acc-cashbook-opening", accountId, fromDate],
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

  // Transactions in range
  const { data: lines } = useQuery({
    queryKey: ["acc-cashbook-lines", accountId, fromDate, toDate],
    queryFn: async () => {
      if (!accountId) return [];
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("*, voucher:accounting_vouchers!inner(id, voucher_number, voucher_type, voucher_date, narration, party_id, source_module, status, reverses_voucher_id), account:accounting_chart_of_accounts(code, name), party:accounting_parties(name)")
          .eq("account_id", accountId)
          .gte("voucher.voucher_date", fromDate)
          .lte("voucher.voucher_date", toDate)
          .order("id", { ascending: true })
          .range(from, to));
      // Sort client-side because supabase orderby on joined column is tricky
      return (data || []).sort((a: any, b: any) => {
        const ad = a.voucher?.voucher_date || "";
        const bd = b.voucher?.voucher_date || "";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.voucher?.voucher_number || "").localeCompare(b.voucher?.voucher_number || "");
      });
    },
    enabled: !!accountId,
  });

  // For each ledger row, fetch the "contra account" — i.e. the other side of the voucher.
  // We also pull the party_id+name from the contra line so the Cash Book row shows the
  // counterparty even though the cash line itself has no party_id (correct accounting:
  // cash doesn't "belong to" a customer; the AR/AP line does).
  const voucherIds = useMemo(() => Array.from(new Set((lines || []).map((l: any) => l.voucher_id))), [lines]);
  const { data: contraData } = useQuery({
    queryKey: ["acc-cashbook-contra", voucherIds.join(",")],
    queryFn: async () => {
      if (!voucherIds.length) return { accountMap: {} as Record<string, string>, partyMap: {} as Record<string, string>, lineCountMap: {} as Record<string, number>, contraMap: {} as Record<string, { accountId: string; partyId: string | null }> };
      const data = await fetchAllRows((from, to) =>
        sb
          .from("accounting_voucher_lines")
          .select("voucher_id, account_id, party_id, debit_amount, credit_amount, account:accounting_chart_of_accounts(name), party:accounting_parties(name)")
          .in("voucher_id", voucherIds)
          .order("id", { ascending: true })
          .range(from, to));
      const accountMap: Record<string, string> = {};
      const partyMap: Record<string, string> = {};
      const lineCountMap: Record<string, number> = {};
      const contraMap: Record<string, { accountId: string; partyId: string | null }> = {};
      (data || []).forEach((l: any) => {
        lineCountMap[l.voucher_id] = (lineCountMap[l.voucher_id] || 0) + 1;
        if (l.account_id === accountId) return;
        if (!accountMap[l.voucher_id]) accountMap[l.voucher_id] = l.account?.name || "";
        else if (!accountMap[l.voucher_id].includes(l.account?.name)) accountMap[l.voucher_id] += ", " + l.account?.name;
        const pname = l.party?.name;
        if (pname && !partyMap[l.voucher_id]) partyMap[l.voucher_id] = pname;
        // The "other side" line — used to pre-fill the edit form.
        if (!contraMap[l.voucher_id]) contraMap[l.voucher_id] = { accountId: l.account_id, partyId: l.party_id || null };
      });
      return { accountMap, partyMap, lineCountMap, contraMap };
    },
    enabled: voucherIds.length > 0,
  });

  // Build running balance
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

  const selectedAccount = cashAccounts?.find((a: any) => a.id === accountId);

  // Only simple, manually-entered cash vouchers are editable in place: a posted
  // CRV/CPV with exactly two lines (cash + one contra), not a reversal/reversed.
  // Auto-posted vouchers (sales, receipts, etc.) must be corrected via reversal
  // so they stay in sync with their source document.
  const isRowEditable = (r: any): boolean => {
    if (!isSuperAdmin) return false;
    const v = r.voucher;
    if (!v) return false;
    if (!["CRV", "CPV"].includes(v.voucher_type)) return false;
    if (v.source_module !== "manual") return false;
    if (v.status !== "posted") return false;
    if (v.reverses_voucher_id) return false;
    if ((contraData?.lineCountMap?.[r.voucher_id] ?? 0) !== 2) return false;
    return true;
  };

  const openEdit = (r: any) => {
    const contra = contraData?.contraMap?.[r.voucher_id];
    setEditVoucherId(r.voucher_id);
    setEdMode(Number(r.debit_amount) > 0 ? "receipt" : "payment");
    setEdDate(r.voucher?.voucher_date || format(new Date(), "yyyy-MM-dd"));
    setEdAmount(String(Number(r.debit_amount) || Number(r.credit_amount) || ""));
    setEdContraId(contra?.accountId || "");
    setEdPartyId(contra?.partyId || "none");
    setEdNote(r.voucher?.narration || "");
  };

  const editMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(edAmount);
      if (!editVoucherId) throw new Error("No voucher selected");
      if (!accountId) throw new Error("Select a cash account");
      if (!edContraId) throw new Error("Select the other-side account");
      if (edContraId === accountId) throw new Error("Other-side account cannot be the cash account itself");
      if (!(amount > 0)) throw new Error("Amount must be greater than zero");
      if (!edDate) throw new Error("Date is required");

      // Re-fetch the voucher's lines so we update in place (preserves line ids /
      // audit trail) and re-validate it is still a simple 2-line cash voucher.
      const { data: existing, error: exErr } = await sb
        .from("accounting_voucher_lines")
        .select("id, account_id")
        .eq("voucher_id", editVoucherId)
        .order("line_order");
      if (exErr) throw exErr;
      if (!existing || existing.length !== 2) throw new Error("This voucher can no longer be edited here (structure changed).");
      const cashLine = existing.find((l: any) => l.account_id === accountId);
      const contraLine = existing.find((l: any) => l.id !== cashLine?.id);
      if (!cashLine || !contraLine) throw new Error("Could not resolve cash / contra line for this voucher.");

      const isReceipt = edMode === "receipt";
      const voucherType = isReceipt ? "CRV" : "CPV";

      const { error: vErr } = await sb
        .from("accounting_vouchers")
        .update({
          voucher_type: voucherType,
          voucher_date: edDate,
          party_id: edPartyId === "none" ? null : edPartyId,
          narration: edNote,
          total_amount: amount,
        })
        .eq("id", editVoucherId);
      if (vErr) throw vErr;

      const { error: cashErr } = await sb
        .from("accounting_voucher_lines")
        .update({
          debit_amount: isReceipt ? amount : 0,
          credit_amount: isReceipt ? 0 : amount,
          line_narration: isReceipt ? "Received" : "Paid",
        })
        .eq("id", cashLine.id);
      if (cashErr) throw cashErr;

      const { error: contraErr } = await sb
        .from("accounting_voucher_lines")
        .update({
          account_id: edContraId,
          party_id: edPartyId === "none" ? null : edPartyId,
          debit_amount: isReceipt ? 0 : amount,
          credit_amount: isReceipt ? amount : 0,
          line_narration: edNote || "",
        })
        .eq("id", contraLine.id);
      if (contraErr) throw contraErr;
    },
    onSuccess: () => {
      toast({ title: "Voucher updated" });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-opening"] });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-cashbook-contra"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["voucher-view-dialog"] });
      queryClient.invalidateQueries({ queryKey: ["voucher-view-dialog-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-recent"] });
      setEditVoucherId(null);
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  return (
    <ERPLayout>
      <PageHeader title="Cash Book" description="Running ledger for any cash account">
        <div className="flex gap-2">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Cash account" /></SelectTrigger>
            <SelectContent>
              {cashAccounts?.map((a: any) => <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px]" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Opening Balance</div><div className="text-xl font-semibold">Rs. {Number(opening || 0).toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Receipts (Dr)</div><div className="text-xl font-semibold text-green-600">Rs. {totalDr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Payments (Cr)</div><div className="text-xl font-semibold text-red-600">Rs. {totalCr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Closing Balance</div><div className="text-xl font-semibold">Rs. {closing.toLocaleString()}</div></CardContent></Card>
      </div>

      {/* Quick Entry — post a CRV or CPV against the selected cash account without leaving the page */}
      <Card className="mb-4 border-dashed">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Quick Entry</span>
            <span className="text-xs text-muted-foreground">
              Posts a {qeMode === "receipt" ? "Cash Receipt (CRV)" : "Cash Payment (CPV)"} against{" "}
              <span className="font-medium">{selectedAccount?.name || "—"}</span>
            </span>
          </div>
          <div className="grid grid-cols-12 gap-2 items-end" onKeyDown={submitOnEnter}>
            <div className="col-span-2">
              <Label className="text-xs">Type</Label>
              <div className="flex rounded-md border overflow-hidden h-9">
                <button
                  type="button"
                  onClick={() => setQeMode("receipt")}
                  className={`flex-1 text-xs flex items-center justify-center gap-1 transition ${qeMode === "receipt" ? "bg-green-600 text-white" : "bg-background hover:bg-muted"}`}
                >
                  <ArrowDownCircle className="h-3 w-3" />Receipt
                </button>
                <button
                  type="button"
                  onClick={() => setQeMode("payment")}
                  className={`flex-1 text-xs flex items-center justify-center gap-1 transition ${qeMode === "payment" ? "bg-red-600 text-white" : "bg-background hover:bg-muted"}`}
                >
                  <ArrowUpCircle className="h-3 w-3" />Payment
                </button>
              </div>
            </div>
            <div className="col-span-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={qeDate} onChange={(e) => setQeDate(e.target.value)} className="h-9" />
            </div>
            <div className="col-span-3">
              <Label className="text-xs">{qeMode === "receipt" ? "Received From (Cr)" : "Paid For (Dr)"}</Label>
              <SearchableSelect
                value={qeContraId}
                onValueChange={setQeContraId}
                placeholder="Select account"
                triggerClassName="h-9 w-full"
                options={otherSideAccounts.map((a: any) => ({
                  value: a.id,
                  label: a.name,
                  secondary: `(${a.code})`,
                  search: a.code,
                }))}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs flex items-center gap-1">
                Party (optional)
                {partyTypeFilter && (
                  <span className="text-[10px] text-muted-foreground italic">
                    — filtered to {partyTypeFilter}s
                  </span>
                )}
              </Label>
              <SearchableSelect
                value={qePartyId}
                onValueChange={setQePartyId}
                placeholder="— None —"
                triggerClassName="h-9 w-full"
                options={[
                  { value: "none", label: "— None —" },
                  ...filteredParties.map((p: any) => ({
                    value: p.id,
                    label: p.name,
                    secondary: partyTypeFilter ? undefined : `(${p.party_type})`,
                  })),
                ]}
              />
            </div>
            <div className="col-span-1">
              <Label className="text-xs">Amount</Label>
              <Input
                ref={amountRef}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={qeAmount}
                onChange={(e) => setQeAmount(e.target.value)}
                className="h-9 text-right"
                placeholder="0"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Note (optional)</Label>
              <Input value={qeNote} onChange={(e) => setQeNote(e.target.value)} className="h-9" placeholder="Narration" />
            </div>
            <div className="col-span-1">
              <Button
                className="w-full h-9"
                onClick={() => quickPostMutation.mutate()}
                disabled={quickPostMutation.isPending || !accountId || !qeContraId || !(parseFloat(qeAmount) > 0)}
              >
                {quickPostMutation.isPending ? "..." : "Post"}
              </Button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Press <kbd className="px-1 border rounded">Enter</kbd> in any field to post. Form clears after each entry (date & type retained).
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Voucher</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead>Party</TableHead>
              <TableHead className="text-right">Receipt (Dr)</TableHead>
              <TableHead className="text-right">Payment (Cr)</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell colSpan={6} className="text-xs italic">Opening Balance — {selectedAccount?.name}</TableCell>
              <TableCell className="text-right font-semibold">Rs. {Number(opening || 0).toLocaleString()}</TableCell>
            </TableRow>
            {!rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No transactions in this range</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.voucher?.voucher_date && format(parseISO(r.voucher.voucher_date), "dd MMM")}</TableCell>
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
                  {isRowEditable(r) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-1 align-middle"
                      onClick={() => openEdit(r)}
                      title="Edit voucher (super admin)"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </TableCell>
                <TableCell className="text-xs">{contraData?.accountMap?.[r.voucher_id] || r.voucher?.narration || "—"}</TableCell>
                <TableCell className="text-xs">{contraData?.partyMap?.[r.voucher_id] || r.party?.name || "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.debit_amount) > 0 ? `Rs. ${Number(r.debit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.credit_amount) > 0 ? `Rs. ${Number(r.credit_amount).toLocaleString()}` : "—"}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {r.runningBalance.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={4}>Closing Balance</TableCell>
              <TableCell className="text-right">Rs. {totalDr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {totalCr.toLocaleString()}</TableCell>
              <TableCell className="text-right">Rs. {closing.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <VoucherViewDialog voucherId={viewVoucherId} onOpenChange={(o) => !o && setViewVoucherId(null)} />

      {/* Edit voucher (super admin only — manual cash vouchers) */}
      <Dialog open={!!editVoucherId} onOpenChange={(o) => { if (!o) setEditVoucherId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Cash Voucher</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Type</Label>
              <div className="flex rounded-md border overflow-hidden h-9">
                <button
                  type="button"
                  onClick={() => setEdMode("receipt")}
                  className={`flex-1 text-xs flex items-center justify-center gap-1 transition ${edMode === "receipt" ? "bg-green-600 text-white" : "bg-background hover:bg-muted"}`}
                >
                  <ArrowDownCircle className="h-3 w-3" />Receipt
                </button>
                <button
                  type="button"
                  onClick={() => setEdMode("payment")}
                  className={`flex-1 text-xs flex items-center justify-center gap-1 transition ${edMode === "payment" ? "bg-red-600 text-white" : "bg-background hover:bg-muted"}`}
                >
                  <ArrowUpCircle className="h-3 w-3" />Payment
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={edDate} onChange={(e) => setEdDate(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{edMode === "receipt" ? "Received From (Cr)" : "Paid For (Dr)"}</Label>
              <SearchableSelect
                value={edContraId}
                onValueChange={setEdContraId}
                placeholder="Select account"
                triggerClassName="h-9 w-full"
                options={otherSideAccounts.map((a: any) => ({
                  value: a.id,
                  label: a.name,
                  secondary: `(${a.code})`,
                  search: a.code,
                }))}
              />
            </div>
            <div>
              <Label className="text-xs">Party (optional)</Label>
              <SearchableSelect
                value={edPartyId}
                onValueChange={setEdPartyId}
                placeholder="— None —"
                triggerClassName="h-9 w-full"
                options={[
                  { value: "none", label: "— None —" },
                  ...(parties || []).map((p: any) => ({ value: p.id, label: p.name, secondary: `(${p.party_type})` })),
                ]}
              />
            </div>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={edAmount}
                onChange={(e) => setEdAmount(e.target.value)}
                className="h-9 text-right"
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Input value={edNote} onChange={(e) => setEdNote(e.target.value)} className="h-9" placeholder="Narration" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setEditVoucherId(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={editMutation.isPending || !edContraId || !(parseFloat(edAmount) > 0)}
                onClick={() => editMutation.mutate()}
              >
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
