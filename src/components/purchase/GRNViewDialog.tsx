import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const sb = supabase as any;
const ATTACHMENT_BUCKET = "grn-attachments";

interface Attachment {
  id: string;
  grn_id: string;
  kind: "bill" | "stock_photo" | "other";
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

function publicUrl(filePath: string): string {
  const { data } = (sb.storage.from(ATTACHMENT_BUCKET).getPublicUrl(filePath)) as { data: { publicUrl: string } };
  return data.publicUrl;
}

function isImage(mime: string | null | undefined, name?: string): boolean {
  if (mime?.startsWith("image/")) return true;
  return !!name?.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i);
}

interface GRNViewDialogProps {
  grnId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function GRNViewDialog({ grnId, onOpenChange }: GRNViewDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadKind, setUploadKind] = useState<"bill" | "stock_photo">("bill");

  const { data: grn } = useQuery({
    queryKey: ["grn-view-dialog", grnId],
    queryFn: async () => {
      if (!grnId) return null;
      const { data, error } = await sb
        .from("goods_receipt_notes")
        .select(`*, suppliers(name, code), purchase_orders(po_number, category)`)
        .eq("id", grnId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!grnId,
  });

  const { data: items } = useQuery({
    queryKey: ["grn-view-dialog-items", grnId],
    queryFn: async () => {
      if (!grnId) return [];
      const { data, error } = await sb
        .from("grn_items")
        .select(`*, items(code, name)`)
        .eq("grn_id", grnId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!grnId,
  });

  const { data: attachments } = useQuery({
    queryKey: ["grn-attachments", grnId],
    queryFn: async () => {
      if (!grnId) return [];
      const { data, error } = await sb
        .from("grn_attachments")
        .select("*")
        .eq("grn_id", grnId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Attachment[];
    },
    enabled: !!grnId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!grnId) throw new Error("No GRN id");
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${grnId}/${crypto.randomUUID()}-${cleanName}`;
      const { error: uploadErr } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await sb.from("grn_attachments").insert({
        grn_id: grnId,
        kind: uploadKind,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
      });
      if (insertErr) {
        // best-effort cleanup so we don't leave orphan files
        await sb.storage.from(ATTACHMENT_BUCKET).remove([path]);
        throw insertErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grn-attachments", grnId] });
      toast({ title: "Attachment uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: Attachment) => {
      await sb.storage.from(ATTACHMENT_BUCKET).remove([a.file_path]);
      const { error } = await sb.from("grn_attachments").delete().eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grn-attachments", grnId] });
      toast({ title: "Attachment removed" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleFilesPicked = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => uploadMutation.mutate(f));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const bills = (attachments || []).filter((a) => a.kind === "bill");
  const photos = (attachments || []).filter((a) => a.kind === "stock_photo");

  return (
    <Dialog open={!!grnId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Goods Receipt: {grn?.grn_number || "—"}</DialogTitle>
        </DialogHeader>
        {grn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>PO #:</strong> {grn.purchase_orders?.po_number || "—"}</div>
              <div><strong>Supplier:</strong> {grn.suppliers?.name || "—"}</div>
              <div><strong>Receipt Date:</strong> {grn.receipt_date ? format(new Date(grn.receipt_date), "dd/MM/yyyy") : "—"}</div>
              <div><strong>Invoice #:</strong> {grn.invoice_number || "—"}</div>
              <div><strong>Invoice Amount:</strong> {grn.invoice_amount ? `Rs. ${Number(grn.invoice_amount).toLocaleString()}` : "—"}</div>
              <div><strong>Total Received:</strong> Rs. {Number(grn.total_amount || 0).toLocaleString()}</div>
            </div>

            {items && items.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.items?.code || "—"}</TableCell>
                      <TableCell>{item.description || item.items?.name}</TableCell>
                      <TableCell className="text-right">{item.quantity_ordered}</TableCell>
                      <TableCell className="text-right">{item.quantity_received}</TableCell>
                      <TableCell className="text-right">Rs. {Number(item.unit_price || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">Rs. {Number(item.amount || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {grn.notes && (
              <div>
                <strong>Notes:</strong>
                <p className="text-muted-foreground">{grn.notes}</p>
              </div>
            )}

            {/* Attachments (bill + stock photos) */}
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                <strong>Attachments</strong>
                <span className="text-xs text-muted-foreground">({attachments?.length || 0})</span>
              </div>

              {/* Upload control */}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as "bill" | "stock_photo")}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bill">Supplier Bill</SelectItem>
                    <SelectItem value="stock_photo">Stock Photo</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept={uploadKind === "stock_photo" ? "image/*" : "image/*,application/pdf"}
                  onChange={(e) => handleFilesPicked(e.target.files)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  {uploadMutation.isPending ? "Uploading…" : "Upload"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {uploadKind === "bill" ? "PDF or image of the supplier invoice." : "Photos of the received stock."}
                </span>
              </div>

              {bills.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Bill ({bills.length})</div>
                  <ul className="space-y-1">
                    {bills.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 px-2 py-1 rounded">
                        <a
                          href={publicUrl(a.file_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 hover:underline truncate"
                        >
                          {isImage(a.mime_type, a.file_name)
                            ? <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                            : <FileText className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate">{a.file_name}</span>
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Remove"
                          onClick={() => deleteMutation.mutate(a)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {photos.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Stock Photos ({photos.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {photos.map((a) => (
                      <div key={a.id} className="relative group border rounded overflow-hidden bg-muted/40">
                        {isImage(a.mime_type, a.file_name) ? (
                          <a href={publicUrl(a.file_path)} target="_blank" rel="noreferrer" title={a.file_name}>
                            <img
                              src={publicUrl(a.file_path)}
                              alt={a.file_name}
                              className="w-full h-24 object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            href={publicUrl(a.file_path)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex flex-col items-center justify-center h-24 text-xs text-muted-foreground"
                          >
                            <FileText className="h-6 w-6 mb-1" />
                            <span className="truncate px-1 max-w-full">{a.file_name}</span>
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 absolute top-0.5 right-0.5 bg-background/80 hover:bg-background"
                          title="Remove"
                          onClick={() => deleteMutation.mutate(a)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!bills.length && !photos.length && (
                <div className="text-xs text-muted-foreground italic">
                  No attachments yet. Use the upload button above to add the supplier bill or stock photos.
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
