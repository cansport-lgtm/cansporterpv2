import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { gpDb } from "@/lib/gatePass";
import type { BackfillState } from "@/lib/gatePassForms";
import { PhotoInput } from "./PhotoInput";

// Manual backfill of an emergency paper pass (managers only).


type Book = { id: string; book_number: string; serial_from: number; serial_to: number; issued_to: string | null; is_active: boolean };
type SerialRow = { serial: number; gate_pass_id: string | null; pass_number: string | null; spoiled_reason: string | null };


export function BackfillFields({ value, onChange }: { value: BackfillState; onChange: (v: BackfillState) => void }) {
  const set = (patch: Partial<BackfillState>) => onChange({ ...value, ...patch });

  const { data: books = [] } = useQuery<Book[]>({
    queryKey: ["gate-pass-books"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_books").select("*").order("book_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: settings } = useQuery<{ backfill_max_days: number } | null>({
    queryKey: ["gate-pass-settings"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("gate_pass_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: serials = [] } = useQuery<SerialRow[]>({
    queryKey: ["gate-pass-book-serials", value.book_id],
    enabled: Boolean(value.book_id),
    queryFn: async () => {
      const { data, error } = await gpDb
        .from("v_gate_pass_book_serials")
        .select("serial, gate_pass_id, pass_number, spoiled_reason")
        .eq("book_id", value.book_id)
        .order("serial");
      if (error) throw error;
      return data ?? [];
    },
  });

  const book = books.find((b) => b.id === value.book_id);
  const serial = Number(value.book_serial);
  const row = serials.find((s) => s.serial === serial);
  const lastUsed = Math.max(0, ...serials.filter((s) => s.gate_pass_id).map((s) => s.serial));
  const gaps = serials.filter((s) => !s.gate_pass_id && !s.spoiled_reason && s.serial < Math.max(lastUsed, serial || 0) && s.serial !== serial);
  const serialNote = !book || !value.book_serial
    ? null
    : serial < book.serial_from || serial > book.serial_to
      ? { ok: false, text: `Not in this book (${book.serial_from}–${book.serial_to})` }
      : row?.gate_pass_id
        ? { ok: false, text: `Already entered as ${row.pass_number}` }
        : row?.spoiled_reason
          ? { ok: false, text: `Marked spoiled: ${row.spoiled_reason}` }
          : { ok: true, text: `Serial ${serial} is free` };
  const maxDays = settings?.backfill_max_days ?? 7;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Paper book</Label>
          <Select value={value.book_id || undefined} onValueChange={(v) => set({ book_id: v })}>
            <SelectTrigger aria-label="Paper book"><SelectValue placeholder="Select book" /></SelectTrigger>
            <SelectContent>
              {books.filter((b) => b.is_active).map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.book_number} ({b.serial_from}–{b.serial_to})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="gp-bf-serial">Book serial</Label>
          <Input id="gp-bf-serial" type="number" value={value.book_serial} onChange={(e) => set({ book_serial: e.target.value })}
            className={cn(serialNote && (serialNote.ok ? "border-emerald-600" : "border-red-600"))} />
          {serialNote && <p className={cn("text-xs mt-1 font-medium", serialNote.ok ? "text-emerald-700" : "text-red-700")}>{serialNote.text}</p>}
        </div>
        <div>
          <Label htmlFor="gp-bf-time">Date and time on paper</Label>
          <Input id="gp-bf-time" type="datetime-local" value={value.paper_datetime} onChange={(e) => set({ paper_datetime: e.target.value })} />
          <p className="text-xs text-muted-foreground mt-1">Must be within the last {maxDays} days.</p>
        </div>
      </div>
      {gaps.length > 0 && (
        <p className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-900 p-2">
          {gaps.length} earlier serial(s) in {book?.book_number} not entered yet: {gaps.slice(0, 12).map((g) => g.serial).join(", ")}
          {gaps.length > 12 ? "…" : ""}. Enter them, or mark them spoiled on the Paper Books page.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
        <div>
          <Label htmlFor="gp-bf-photo">Photo of the paper pass *</Label>
          <PhotoInput id="gp-bf-photo" label="Photo of paper pass" folder="paper-pass" value={value.photo_path}
            onChange={(p) => set({ photo_path: p })} />
        </div>
        <div>
          <Label htmlFor="gp-bf-reason">Why was a paper pass used? *</Label>
          <Textarea id="gp-bf-reason" rows={4} value={value.reason} onChange={(e) => set({ reason: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

