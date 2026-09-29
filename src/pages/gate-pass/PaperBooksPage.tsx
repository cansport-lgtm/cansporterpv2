import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { BookOpen, Plus, Settings2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { errorMessage, gpDb, passTypeMeta } from "@/lib/gatePass";

type Book = { id: string; book_number: string; serial_from: number; serial_to: number; issued_to: string | null; is_active: boolean };
type Serial = { book_id: string; serial: number; gate_pass_id: string | null; pass_number: string | null; spoiled_reason: string | null };
type Backfill = {
  id: string; pass_number: string; pass_type: string; party_name: string; paper_datetime: string | null; book_serial: number | null;
  backfill_reason: string | null; created_at: string; gate_pass_books: { book_number: string } | null; creator: { full_name: string | null } | null;
};

export default function PaperBooksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { roles, hasModulePermission } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const canManage = hasModulePermission("gate_pass", "approve");
  const [selected, setSelected] = useState<string>("");
  const [bookDialog, setBookDialog] = useState<{ book?: Book } | null>(null);
  const [bookForm, setBookForm] = useState({ number: "", from: "", to: "", issued: "", active: true });
  const [spoil, setSpoil] = useState<{ serial: number } | null>(null);
  const [spoilReason, setSpoilReason] = useState("");
  const [settings, setSettings] = useState({ days: "7", pct: "10" });

  const { data: books = [] } = useQuery<Book[]>({
    queryKey: ["gate-pass-books"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_books").select("*").order("book_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: serials = [] } = useQuery<Serial[]>({
    queryKey: ["gate-pass-book-serials-all"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_gate_pass_book_serials").select("book_id, serial, gate_pass_id, pass_number, spoiled_reason").order("serial").limit(20000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: backfills = [] } = useQuery<Backfill[]>({
    queryKey: ["gate-pass-backfills"],
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("gate_passes")
        .select("id, pass_number, pass_type, party_name, paper_datetime, book_serial, backfill_reason, created_at, gate_pass_books(book_number), creator:app_users!gate_passes_created_by_fkey(full_name)")
        .eq("is_backfill", true).neq("status", "cancelled")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: savedSettings } = useQuery<{ backfill_max_days: number; scrap_overweight_pct: number } | null>({
    queryKey: ["gate-pass-settings"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (savedSettings) setSettings({ days: String(savedSettings.backfill_max_days), pct: String(savedSettings.scrap_overweight_pct) });
  }, [savedSettings]);
  useEffect(() => {
    if (!selected && books.length) setSelected(books.find((b) => b.is_active)?.id ?? books[0].id);
  }, [books, selected]);

  const stats = useMemo(() => {
    const m = new Map<string, { used: number; spoiled: number; gaps: number; last: number }>();
    books.forEach((b) => {
      const s = serials.filter((x) => x.book_id === b.id);
      const last = Math.max(0, ...s.filter((x) => x.gate_pass_id).map((x) => x.serial));
      m.set(b.id, {
        used: s.filter((x) => x.gate_pass_id).length,
        spoiled: s.filter((x) => x.spoiled_reason).length,
        gaps: s.filter((x) => !x.gate_pass_id && !x.spoiled_reason && x.serial < last).length,
        last,
      });
    });
    return m;
  }, [books, serials]);

  const book = books.find((b) => b.id === selected);
  const bookSerials = serials.filter((s) => s.book_id === selected);
  const last = stats.get(selected)?.last ?? 0;

  const refresh = () => {
    ["gate-pass-books", "gate-pass-book-serials-all", "gate-pass-book-serials", "gate-pass-settings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const call = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; done: string }) => {
      const { error } = await gpDb.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast({ title: v.done }); setBookDialog(null); setSpoil(null); setSpoilReason(""); refresh(); },
    onError: (e) => toast({ title: "Could not save", description: errorMessage(e), variant: "destructive" }),
  });

  const openBook = (b?: Book) => {
    setBookForm({
      number: b?.book_number ?? "", from: b ? String(b.serial_from) : "", to: b ? String(b.serial_to) : "",
      issued: b?.issued_to ?? "", active: b?.is_active ?? true,
    });
    setBookDialog({ book: b });
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Paper Books" description="Emergency paper gate-pass books, their serials, and every manual backfill" icon={BookOpen}>
          {canManage && <Button onClick={() => openBook()}><Plus className="h-4 w-4 mr-1" /> New book</Button>}
        </PageHeader>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Book</TableHead>
                  <TableHead>Serials</TableHead>
                  <TableHead>Issued to</TableHead>
                  <TableHead className="text-right">Entered</TableHead>
                  <TableHead className="text-right">Spoiled</TableHead>
                  <TableHead className="text-right">Gaps</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {books.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No paper books yet.</TableCell></TableRow>
                ) : books.map((b) => {
                  const st = stats.get(b.id);
                  return (
                    <TableRow key={b.id} className={cn("cursor-pointer", selected === b.id && "bg-muted/50", !b.is_active && "opacity-60")} onClick={() => setSelected(b.id)}>
                      <TableCell className="font-semibold">{b.book_number}{!b.is_active && " (closed)"}</TableCell>
                      <TableCell className="tabular-nums">{b.serial_from}–{b.serial_to}</TableCell>
                      <TableCell className="text-sm">{b.issued_to ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{st?.used ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{st?.spoiled ?? 0}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", st?.gaps ? "text-amber-700 font-semibold" : "")}>{st?.gaps ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {canManage && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openBook(b); }}>Edit</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {book && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{book.book_number} — serials</CardTitle>
              <p className="text-sm text-muted-foreground">
                <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 align-middle mr-1" />entered
                <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 align-middle ml-3 mr-1" />gap (before the last entered)
                <span className="inline-block w-3 h-3 rounded-sm bg-stone-400 align-middle ml-3 mr-1" />spoiled
                <span className="inline-block w-3 h-3 rounded-sm border align-middle ml-3 mr-1" />not used yet.
                {canManage && " Click a gap or unused serial to mark it spoiled."}
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {bookSerials.map((s) => {
                const gap = !s.gate_pass_id && !s.spoiled_reason && s.serial < last;
                const cls = s.gate_pass_id ? "bg-emerald-600 text-white border-emerald-600"
                  : s.spoiled_reason ? "bg-stone-400 text-white border-stone-400"
                  : gap ? "bg-amber-400 text-amber-950 border-amber-400" : "bg-background";
                const title = s.pass_number ?? s.spoiled_reason ?? (gap ? "Not entered (gap)" : "Not used yet");
                return s.gate_pass_id ? (
                  <Link key={s.serial} to={`/gate-pass/passes/${s.gate_pass_id}`} title={title}
                    className={cn("w-12 h-9 rounded-md border text-xs font-medium flex items-center justify-center tabular-nums", cls)}>
                    {s.serial}
                  </Link>
                ) : (
                  <button key={s.serial} type="button" title={title} disabled={!canManage || Boolean(s.spoiled_reason)}
                    onClick={() => { setSpoilReason(""); setSpoil({ serial: s.serial }); }}
                    className={cn("w-12 h-9 rounded-md border text-xs font-medium tabular-nums disabled:cursor-default", cls)}>
                    {s.serial}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Backfill register</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Pass</TableHead>
                  <TableHead>Paper</TableHead>
                  <TableHead>Written on paper</TableHead>
                  <TableHead>Type · party</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Entered by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backfills.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No backfills yet.</TableCell></TableRow>
                ) : backfills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Link to={`/gate-pass/passes/${b.id}`} className="text-primary hover:underline font-mono text-sm">{b.pass_number}</Link></TableCell>
                    <TableCell className="text-sm">{b.gate_pass_books?.book_number} / {b.book_serial}</TableCell>
                    <TableCell className="text-sm">{b.paper_datetime ? format(new Date(b.paper_datetime), "dd MMM yyyy, HH:mm") : "—"}</TableCell>
                    <TableCell className="text-sm">{passTypeMeta(b.pass_type).label} · {b.party_name}</TableCell>
                    <TableCell className="text-sm max-w-[260px]">{b.backfill_reason}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.creator?.full_name} · {format(new Date(b.created_at), "dd MMM HH:mm")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {isSuperAdmin && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" /> Gate pass settings</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="st-days">Backfill limit (days)</Label>
                <Input id="st-days" type="number" min="1" max="60" className="w-32" value={settings.days} onChange={(e) => setSettings({ ...settings, days: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="st-pct">Scrap overweight allowed (%)</Label>
                <Input id="st-pct" type="number" min="0" className="w-32" value={settings.pct} onChange={(e) => setSettings({ ...settings, pct: e.target.value })} />
              </div>
              <Button disabled={call.isPending}
                onClick={() => call.mutate({ fn: "gate_pass_settings_save", args: { p_backfill_days: Number(settings.days), p_scrap_overweight_pct: Number(settings.pct) }, done: "Settings saved" })}>
                Save settings
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={bookDialog !== null} onOpenChange={(o) => { if (!o) setBookDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bookDialog?.book ? `Edit ${bookDialog.book.book_number}` : "New paper book"}</DialogTitle>
            <DialogDescription>The serial numbers printed in the book.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="bk-no">Book number</Label><Input id="bk-no" value={bookForm.number} onChange={(e) => setBookForm({ ...bookForm, number: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="bk-from">First serial</Label><Input id="bk-from" type="number" value={bookForm.from} onChange={(e) => setBookForm({ ...bookForm, from: e.target.value })} /></div>
              <div><Label htmlFor="bk-to">Last serial</Label><Input id="bk-to" type="number" value={bookForm.to} onChange={(e) => setBookForm({ ...bookForm, to: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="bk-iss">Issued to</Label><Input id="bk-iss" value={bookForm.issued} placeholder="e.g. Main gate" onChange={(e) => setBookForm({ ...bookForm, issued: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <Checkbox id="bk-active" checked={bookForm.active} onCheckedChange={(v) => setBookForm({ ...bookForm, active: v === true })} />
              <Label htmlFor="bk-active">In use</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookDialog(null)}>Back</Button>
            <Button disabled={call.isPending} onClick={() => call.mutate({
              fn: "gate_pass_book_save",
              args: { p_id: bookDialog?.book?.id ?? null, p_book_number: bookForm.number, p_from: Number(bookForm.from), p_to: Number(bookForm.to), p_issued_to: bookForm.issued, p_active: bookForm.active },
              done: "Book saved",
            })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={spoil !== null} onOpenChange={(o) => { if (!o) setSpoil(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark serial {spoil?.serial} spoiled</DialogTitle>
            <DialogDescription>For a page that was torn, written wrongly or lost. It then no longer shows as a gap.</DialogDescription>
          </DialogHeader>
          <div><Label htmlFor="sp-reason">Reason *</Label><Input id="sp-reason" value={spoilReason} onChange={(e) => setSpoilReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpoil(null)}>Back</Button>
            <Button disabled={call.isPending} onClick={() => spoil && call.mutate({
              fn: "gate_pass_book_spoil", args: { p_book: selected, p_serial: spoil.serial, p_reason: spoilReason }, done: `Serial ${spoil.serial} marked spoiled`,
            })}>Mark spoiled</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
