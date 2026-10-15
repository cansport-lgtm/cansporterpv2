import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchColors, saveColor, type PljoColor } from "@/lib/privateLabelJobOrder";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Editing = { id?: string; name: string; swatch: string; sort_order: string; is_active: boolean };

/** The Color list used on Private Label Job Order lines. Colors are switched off, never deleted. */
export function PrivateLabelColorsDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);

  const { data: colors = [] } = useQuery({
    queryKey: ["pljo-colors-all"],
    queryFn: () => fetchColors(true),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (c: { id?: string; name: string; swatch: string | null; sort_order: number; is_active: boolean }) =>
      saveColor(c),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pljo-colors-all"] });
      qc.invalidateQueries({ queryKey: ["pljo-colors"] });
      setEditing(null);
      toast.success("Color saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!editing?.name.trim()) {
      toast.error("Enter the color name");
      return;
    }
    save.mutate({
      id: editing.id,
      name: editing.name,
      swatch: editing.swatch || null,
      sort_order: parseInt(editing.sort_order) || 0,
      is_active: editing.is_active,
    });
  };

  const toggle = (c: PljoColor) => save.mutate({ ...c, is_active: !c.is_active });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Private Label Colors</DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="min-w-[140px] flex-1">
              <label className="text-xs text-muted-foreground" htmlFor="pljo-color-name">
                Color
              </label>
              <Input
                id="pljo-color-name"
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Peach"
              />
            </div>
            <div className="w-16">
              <label className="text-xs text-muted-foreground" htmlFor="pljo-color-swatch">
                Dot
              </label>
              <Input
                id="pljo-color-swatch"
                type="color"
                className="h-10 p-1"
                value={editing.swatch || "#cccccc"}
                onChange={(e) => setEditing({ ...editing, swatch: e.target.value })}
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground" htmlFor="pljo-color-order">
                Order
              </label>
              <Input
                id="pljo-color-order"
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
            onClick={() =>
              setEditing({ name: "", swatch: "", sort_order: String(colors.length + 1), is_active: true })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add color
          </Button>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Color</TableHead>
                <TableHead className="w-16 text-right">Order</TableHead>
                <TableHead className="w-20">Active</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {colors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No colors yet
                  </TableCell>
                </TableRow>
              )}
              {colors.map((c) => (
                <TableRow key={c.id} className={c.is_active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {c.swatch && (
                        <span className="h-3.5 w-3.5 rounded-full border" style={{ backgroundColor: c.swatch }} />
                      )}
                      {c.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{c.sort_order}</TableCell>
                  <TableCell>
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={() => toggle(c)}
                      disabled={save.isPending}
                      aria-label={`${c.name} active`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={`Edit ${c.name}`}
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          name: c.name,
                          swatch: c.swatch ?? "",
                          sort_order: String(c.sort_order),
                          is_active: c.is_active,
                        })
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
