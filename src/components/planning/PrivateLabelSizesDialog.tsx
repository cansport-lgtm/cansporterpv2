import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchSizes, saveSize, type PljoSize } from "@/lib/privateLabelJobOrder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The Size list used on Private Label Job Order lines. Sizes are switched off, never deleted. */
export function PrivateLabelSizesDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ id?: string; name: string; sort_order: string; is_active: boolean } | null>(
    null,
  );

  const { data: sizes = [] } = useQuery({
    queryKey: ["pljo-sizes-all"],
    queryFn: () => fetchSizes(true),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (s: { id?: string; name: string; sort_order: number; is_active: boolean }) => saveSize(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pljo-sizes-all"] });
      qc.invalidateQueries({ queryKey: ["pljo-sizes"] });
      setEditing(null);
      toast.success("Size saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!editing?.name.trim()) {
      toast.error("Enter the size name");
      return;
    }
    save.mutate({
      id: editing.id,
      name: editing.name,
      sort_order: parseInt(editing.sort_order) || 0,
      is_active: editing.is_active,
    });
  };

  const toggle = (s: PljoSize) => save.mutate({ ...s, is_active: !s.is_active });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Private Label Sizes</DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Size</label>
              <Input
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Size 5"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Order</label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
              />
            </div>
            <Button size="sm" onClick={submit} disabled={save.isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => setEditing({ name: "", sort_order: String(sizes.length + 1), is_active: true })}
          >
            <Plus className="mr-1 h-4 w-4" /> Add size
          </Button>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Size</TableHead>
                <TableHead className="w-16 text-right">Order</TableHead>
                <TableHead className="w-20">Active</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sizes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No sizes yet
                  </TableCell>
                </TableRow>
              )}
              {sizes.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-right">{s.sort_order}</TableCell>
                  <TableCell>
                    <Switch checked={s.is_active} onCheckedChange={() => toggle(s)} disabled={save.isPending} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        setEditing({ id: s.id, name: s.name, sort_order: String(s.sort_order), is_active: s.is_active })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
