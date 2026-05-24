import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle, AlertTriangle, ArrowLeft, Wallet, Landmark, BookOpen, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

const sb = supabase as any;

type VoucherType = "CRV" | "CPV" | "BRV" | "BPV" | "JV" | "CV" | "OB";

const VOUCHER_TYPES: { value: VoucherType; label: string; description: string; mode: "receipt" | "payment" | "journal" | "contra" }[] = [
  { value: "CRV", label: "Cash Receipt Voucher", description: "Cash received", mode: "receipt" },
  { value: "CPV", label: "Cash Payment Voucher", description: "Cash paid out", mode: "payment" },
  { value: "BRV", label: "Bank Receipt Voucher", description: "Money received in bank", mode: "receipt" },
  { value: "BPV", label: "Bank Payment Voucher", description: "Bank payment / cheque issued", mode: "payment" },
  { value: "JV", label: "Journal Voucher", description: "Manual adjustment / accrual", mode: "journal" },
  { value: "CV", label: "Contra Voucher", description: "Cash ↔ Bank or Bank ↔ Bank transfer", mode: "contra" },
  { value: "OB", label: "Opening Balance", description: "Initial balances on go-live", mode: "journal" },
];

interface VoucherLine {
  account_id: string;
  party_id: string | null;
  debit_amount: number;
  credit_amount: number;
  line_narration: string;
}

const blankLine = (): VoucherLine => ({ account_id: "", party_id: null, debit_amount: 0, credit_amount: 0, line_narration: "" });

export default function NewVoucherPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const initialType = (searchParams.get("type") as VoucherType) || "CRV";
  const [type, setType] = useState<VoucherType>(initialType);
  const meta = VOUCHER_TYPES.find((v) => v.value === type)!;

  const [voucherDate, setVoucherDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [partyId, setPartyId] = useState<string>("none");
  const [narration, setNarration] = useState("");

  // Receipt/Payment modes: one fixed primary account (Dr for receipt, Cr for payment) + free other-side lines
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [secondaryLines, setSecondaryLines] = useState<VoucherLine[]>([blankLine()]);

  // Contra mode: from + to + amount
  const [contraFromId, setContraFromId] = useState(""); // Cr
  const [contraToId, setContraToId] = useState(""); // Dr
  const [contraAmount, setContraAmount] = useState(0);

  // Journal / OB mode: free Dr+Cr lines
  const [journalLines, setJournalLines] = useState<VoucherLine[]>([blankLine(), blankLine()]);

  // Reset state when voucher type changes
  useEffect(() => {
    setPrimaryAccountId("");
    setSecondaryLines([blankLine()]);
    setContraFromId("");
    setContraToId("");
    setContraAmount(0);
    setJournalLines([blankLine(), blankLine()]);
  }, [type]);

  const { data: accounts } = useQuery({
    queryKey: ["accounting-coa-active"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("accounting_chart_of_accounts")
        .select("id, code, name, account_type, sub_category, is_cash_account, is_bank_account")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: parties } = useQuery({
    queryKey: ["accounting-parties-active"],
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

  const allAccounts = accounts || [];
  const cashAccounts = useMemo(() => allAccounts.filter((a: any) => a.is_cash_account), [allAccounts]);
  const bankAccounts = useMemo(() => allAccounts.filter((a: any) => a.is_bank_account), [allAccounts]);
  const cashOrBankAccounts = useMemo(() => allAccounts.filter((a: any) => a.is_cash_account || a.is_bank_account), [allAccounts]);
  const postableAccounts = useMemo(() => allAccounts.filter((a: any) => a.sub_category !== null), [allAccounts]);
  // For Cr in receipt vouchers / Dr in payment vouchers: any account except the primary cash/bank itself
  const otherSideAccounts = useMemo(() => postableAccounts.filter((a: any) => a.id !== primaryAccountId), [postableAccounts, primaryAccountId]);

  // Auto-pick primary account for receipt/payment when accounts load
  useEffect(() => {
    if (!primaryAccountId) {
      const isCash = type === "CRV" || type === "CPV";
      const isBank = type === "BRV" || type === "BPV";
      if (isCash && cashAccounts.length > 0) setPrimaryAccountId(cashAccounts[0].id);
      else if (isBank && bankAccounts.length > 0) setPrimaryAccountId(bankAccounts[0].id);
    }
  }, [type, cashAccounts, bankAccounts, primaryAccountId]);

  // ----- Compute totals & build lines payload -----
  const { totalDebit, totalCredit, isBalanced, finalLines } = useMemo(() => {
    if (meta.mode === "receipt" || meta.mode === "payment") {
      const isReceipt = meta.mode === "receipt";
      const sum = secondaryLines.reduce((s, l) => s + (Number(l.debit_amount) || Number(l.credit_amount) || 0), 0);
      const finalLines: VoucherLine[] = [
        {
          account_id: primaryAccountId,
          party_id: null,
          debit_amount: isReceipt ? sum : 0,
          credit_amount: isReceipt ? 0 : sum,
          line_narration: isReceipt ? "Received" : "Paid",
        },
        ...secondaryLines.map((l) => ({
          ...l,
          debit_amount: isReceipt ? 0 : Number(l.debit_amount) || 0,
          credit_amount: isReceipt ? Number(l.credit_amount) || 0 : 0,
        })),
      ];
      const valid = !!primaryAccountId && sum > 0 && secondaryLines.every((l) => l.account_id && (Number(l.debit_amount) > 0 || Number(l.credit_amount) > 0));
      return { totalDebit: sum, totalCredit: sum, isBalanced: valid, finalLines };
    }
    if (meta.mode === "contra") {
      const finalLines: VoucherLine[] = contraFromId && contraToId && contraAmount > 0 ? [
        { account_id: contraToId, party_id: null, debit_amount: contraAmount, credit_amount: 0, line_narration: "Contra Dr" },
        { account_id: contraFromId, party_id: null, debit_amount: 0, credit_amount: contraAmount, line_narration: "Contra Cr" },
      ] : [];
      const valid = !!contraFromId && !!contraToId && contraFromId !== contraToId && contraAmount > 0;
      return { totalDebit: contraAmount, totalCredit: contraAmount, isBalanced: valid, finalLines };
    }
    // journal mode (JV, OB)
    const td = journalLines.reduce((s, l) => s + (Number(l.debit_amount) || 0), 0);
    const tc = journalLines.reduce((s, l) => s + (Number(l.credit_amount) || 0), 0);
    const filtered = journalLines.filter((l) => l.account_id && (Number(l.debit_amount) > 0 || Number(l.credit_amount) > 0));
    const valid = Math.abs(td - tc) < 0.01 && td > 0 && filtered.length >= 2;
    return { totalDebit: td, totalCredit: tc, isBalanced: valid, finalLines: filtered };
  }, [meta.mode, primaryAccountId, secondaryLines, contraFromId, contraToId, contraAmount, journalLines]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!isBalanced) throw new Error("Voucher is not balanced or has missing fields");

      const { data: voucher, error: vErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: type,
          voucher_date: voucherDate,
          party_id: partyId === "none" ? null : partyId,
          narration,
          total_amount: totalDebit,
          status: "posted",
          source_module: "manual",
        })
        .select()
        .single();
      if (vErr) throw vErr;

      const linesPayload = finalLines.map((l, i) => ({
        voucher_id: voucher.id,
        account_id: l.account_id,
        party_id: l.party_id,
        debit_amount: Number(l.debit_amount) || 0,
        credit_amount: Number(l.credit_amount) || 0,
        line_narration: l.line_narration || "",
        line_order: i,
      }));
      const { error: lErr } = await sb.from("accounting_voucher_lines").insert(linesPayload);
      if (lErr) throw lErr;

      return voucher;
    },
    onSuccess: (voucher) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-lines"] });
      queryClient.invalidateQueries({ queryKey: ["acc-dash-recent"] });
      toast({ title: `${type} posted`, description: voucher.voucher_number });
      navigate("/accounting/vouchers");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ----- Helpers for the form -----
  const updateSecondary = (i: number, patch: Partial<VoucherLine>) => {
    const next = [...secondaryLines];
    next[i] = { ...next[i], ...patch };
    setSecondaryLines(next);
  };
  const updateJournal = (i: number, patch: Partial<VoucherLine>) => {
    const next = [...journalLines];
    next[i] = { ...next[i], ...patch };
    setJournalLines(next);
  };

  const accountName = (id: string) => allAccounts.find((a: any) => a.id === id)?.name || "—";

  return (
    <ERPLayout>
      <PageHeader title={`New ${meta.label}`} description={meta.description}>
        <Link to="/accounting/vouchers"><Button size="sm" variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Voucher Details</span>
              <Badge variant="outline" className="font-mono">{type}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Voucher Type *</Label>
                <Select value={type} onValueChange={(v: VoucherType) => setType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOUCHER_TYPES.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        <span className="font-mono text-xs mr-2">{v.value}</span>{v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date *</Label>
                <Input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
              </div>
              <div>
                <Label>Voucher #</Label>
                <Input value="Auto-generated on save" disabled className="text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Reference Party (optional, header-level)</Label>
                <SearchableSelect
                  value={partyId}
                  onValueChange={setPartyId}
                  placeholder="— None —"
                  options={[
                    { value: "none", label: "— None —" },
                    ...(parties || []).map((p: any) => ({
                      value: p.id,
                      label: p.name,
                      secondary: `(${p.party_type})`,
                    })),
                  ]}
                />
              </div>
              <div>
                <Label>Narration</Label>
                <Textarea rows={1} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Description of the transaction" />
              </div>
            </div>

            {/* ============== RECEIPT MODE (CRV / BRV) ============== */}
            {meta.mode === "receipt" && (
              <>
                <div>
                  <Label>{type === "CRV" ? "Cash" : "Bank"} Account to Debit *</Label>
                  <Select value={primaryAccountId} onValueChange={setPrimaryAccountId}>
                    <SelectTrigger><SelectValue placeholder={`Select ${type === "CRV" ? "cash" : "bank"} account`} /></SelectTrigger>
                    <SelectContent>
                      {(type === "CRV" ? cashAccounts : bankAccounts).map((a: any) => (
                        <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Credit Side — source(s) of receipt</Label>
                    <Button size="sm" variant="outline" onClick={() => setSecondaryLines([...secondaryLines, blankLine()])}><Plus className="h-3 w-3 mr-1" />Add Line</Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account (Cr)</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead className="w-32 text-right">Amount</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {secondaryLines.map((line, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <SearchableSelect
                              value={line.account_id}
                              onValueChange={(v) => updateSecondary(i, { account_id: v })}
                              placeholder="Select account"
                              triggerClassName="h-8 w-full"
                              options={otherSideAccounts.map((a: any) => ({
                                value: a.id, label: a.name, secondary: `(${a.code})`, search: a.code,
                              }))}
                            />
                          </TableCell>
                          <TableCell>
                            <SearchableSelect
                              value={line.party_id || "none"}
                              onValueChange={(v) => updateSecondary(i, { party_id: v === "none" ? null : v })}
                              placeholder="—"
                              triggerClassName="h-8 w-full"
                              options={[
                                { value: "none", label: "—" },
                                ...(parties || []).map((p: any) => ({ value: p.id, label: p.name })),
                              ]}
                            />
                          </TableCell>
                          <TableCell>
                            <Input type="number" className="h-8 text-right" value={line.credit_amount || ""}
                              onChange={(e) => updateSecondary(i, { credit_amount: parseFloat(e.target.value) || 0 })} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-8 text-xs" value={line.line_narration}
                              onChange={(e) => updateSecondary(i, { line_narration: e.target.value })} placeholder="optional" />
                          </TableCell>
                          <TableCell>
                            {secondaryLines.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSecondaryLines(secondaryLines.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3" /></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {/* ============== PAYMENT MODE (CPV / BPV) ============== */}
            {meta.mode === "payment" && (
              <>
                <div>
                  <Label>{type === "CPV" ? "Cash" : "Bank"} Account to Credit *</Label>
                  <Select value={primaryAccountId} onValueChange={setPrimaryAccountId}>
                    <SelectTrigger><SelectValue placeholder={`Select ${type === "CPV" ? "cash" : "bank"} account`} /></SelectTrigger>
                    <SelectContent>
                      {(type === "CPV" ? cashAccounts : bankAccounts).map((a: any) => (
                        <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Debit Side — what was paid for</Label>
                    <Button size="sm" variant="outline" onClick={() => setSecondaryLines([...secondaryLines, blankLine()])}><Plus className="h-3 w-3 mr-1" />Add Line</Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account (Dr)</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead className="w-32 text-right">Amount</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {secondaryLines.map((line, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <SearchableSelect
                              value={line.account_id}
                              onValueChange={(v) => updateSecondary(i, { account_id: v })}
                              placeholder="Select account"
                              triggerClassName="h-8 w-full"
                              options={otherSideAccounts.map((a: any) => ({
                                value: a.id, label: a.name, secondary: `(${a.code})`, search: a.code,
                              }))}
                            />
                          </TableCell>
                          <TableCell>
                            <SearchableSelect
                              value={line.party_id || "none"}
                              onValueChange={(v) => updateSecondary(i, { party_id: v === "none" ? null : v })}
                              placeholder="—"
                              triggerClassName="h-8 w-full"
                              options={[
                                { value: "none", label: "—" },
                                ...(parties || []).map((p: any) => ({ value: p.id, label: p.name })),
                              ]}
                            />
                          </TableCell>
                          <TableCell>
                            <Input type="number" className="h-8 text-right" value={line.debit_amount || ""}
                              onChange={(e) => updateSecondary(i, { debit_amount: parseFloat(e.target.value) || 0 })} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-8 text-xs" value={line.line_narration}
                              onChange={(e) => updateSecondary(i, { line_narration: e.target.value })} placeholder="optional" />
                          </TableCell>
                          <TableCell>
                            {secondaryLines.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSecondaryLines(secondaryLines.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3" /></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {/* ============== CONTRA MODE (CV) ============== */}
            {meta.mode === "contra" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>From Account (Cr) *</Label>
                  <Select value={contraFromId} onValueChange={setContraFromId}>
                    <SelectTrigger><SelectValue placeholder="Source cash/bank" /></SelectTrigger>
                    <SelectContent>
                      {cashOrBankAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To Account (Dr) *</Label>
                  <Select value={contraToId} onValueChange={setContraToId}>
                    <SelectTrigger><SelectValue placeholder="Destination cash/bank" /></SelectTrigger>
                    <SelectContent>
                      {cashOrBankAccounts.filter((a: any) => a.id !== contraFromId).map((a: any) => (
                        <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs mr-2">{a.code}</span>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Amount *</Label>
                  <Input type="number" value={contraAmount || ""} onChange={(e) => setContraAmount(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            )}

            {/* ============== JOURNAL / OPENING BALANCE MODE (JV / OB) ============== */}
            {meta.mode === "journal" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">{type === "OB" ? "Opening Balance Lines" : "Journal Lines"} (Dr = Cr)</Label>
                  <Button size="sm" variant="outline" onClick={() => setJournalLines([...journalLines, blankLine()])}><Plus className="h-3 w-3 mr-1" />Add Line</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="w-28 text-right">Debit</TableHead>
                      <TableHead className="w-28 text-right">Credit</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journalLines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <SearchableSelect
                            value={line.account_id}
                            onValueChange={(v) => updateJournal(i, { account_id: v })}
                            placeholder="Select account"
                            triggerClassName="h-8 w-full"
                            options={postableAccounts.map((a: any) => ({
                              value: a.id, label: a.name, secondary: `(${a.code})`, search: a.code,
                            }))}
                          />
                        </TableCell>
                        <TableCell>
                          <SearchableSelect
                            value={line.party_id || "none"}
                            onValueChange={(v) => updateJournal(i, { party_id: v === "none" ? null : v })}
                            placeholder="—"
                            triggerClassName="h-8 w-full"
                            options={[
                              { value: "none", label: "—" },
                              ...(parties || []).map((p: any) => ({ value: p.id, label: p.name })),
                            ]}
                          />
                        </TableCell>
                        <TableCell>
                          <Input type="number" className="h-8 text-right" value={line.debit_amount || ""}
                            onChange={(e) => updateJournal(i, { debit_amount: parseFloat(e.target.value) || 0, credit_amount: 0 })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" className="h-8 text-right" value={line.credit_amount || ""}
                            onChange={(e) => updateJournal(i, { credit_amount: parseFloat(e.target.value) || 0, debit_amount: 0 })} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8 text-xs" value={line.line_narration}
                            onChange={(e) => updateJournal(i, { line_narration: e.target.value })} placeholder="optional" />
                        </TableCell>
                        <TableCell>
                          {journalLines.length > 2 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setJournalLines(journalLines.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============== POSTING PREVIEW PANEL ============== */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Posting Preview</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="border rounded-md p-3 bg-green-50 dark:bg-green-950/20">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  {type === "CRV" || type === "CPV" ? <Wallet className="h-3 w-3" /> :
                   type === "BRV" || type === "BPV" ? <Landmark className="h-3 w-3" /> :
                   type === "CV" ? <ArrowRightLeft className="h-3 w-3" /> :
                   <BookOpen className="h-3 w-3" />} Debit (Dr)
                </div>
                {finalLines.filter((l) => Number(l.debit_amount) > 0).map((l, i) => (
                  <div key={i} className="flex justify-between text-xs mb-1">
                    <span>{accountName(l.account_id)}</span>
                    <span className="font-medium">Rs. {Number(l.debit_amount).toLocaleString()}</span>
                  </div>
                ))}
                <div className="text-right font-semibold mt-1 border-t pt-1">Rs. {totalDebit.toLocaleString()}</div>
              </div>

              <div className="border rounded-md p-3 bg-red-50 dark:bg-red-950/20">
                <div className="text-xs text-muted-foreground mb-1">Credit (Cr)</div>
                {finalLines.filter((l) => Number(l.credit_amount) > 0).map((l, i) => (
                  <div key={i} className="flex justify-between text-xs mb-1">
                    <span>{accountName(l.account_id)}</span>
                    <span className="font-medium">Rs. {Number(l.credit_amount).toLocaleString()}</span>
                  </div>
                ))}
                <div className="text-right font-semibold mt-1 border-t pt-1">Rs. {totalCredit.toLocaleString()}</div>
              </div>

              <div className="flex items-center justify-between border rounded-md p-3">
                <span className="text-sm font-medium">Balanced</span>
                {isBalanced ? (
                  <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Yes</Badge>
                ) : (
                  <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />No</Badge>
                )}
              </div>

              <Button className="w-full" disabled={!isBalanced || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "Posting..." : `Post ${type}`}
              </Button>

              <div className="text-xs text-muted-foreground">
                On post: voucher header + {finalLines.length} line(s) inserted. Auto-numbered <span className="font-mono">{type}-YYYYMM-NNNN</span>.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
