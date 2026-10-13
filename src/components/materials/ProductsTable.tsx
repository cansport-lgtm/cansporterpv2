import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtQty, type ItemStock, type MaterialItem, type MaterialSlot, type ProductMaterial, type SlotKey } from "@/lib/productMaterials";
import { effectiveMaterials, STOCK_DOT, STOCK_TEXT, stockLevel } from "@/components/materials/useMaterialData";

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  owner_type: string | null;
  customer_party_id: string | null;
  base_product_id: string | null;
  standard_output_rate: number | null;
  standard_cost: number | null;
  standard_selling_price: number | null;
  is_active: boolean | null;
  color: string | null;
  grades?: { name: string } | null;
  units_of_measure?: { name: string } | null;
  planning_items?: { code: string; name: string } | null;
}

interface Props {
  products: ProductRow[];
  slots: MaterialSlot[];
  byProduct: Map<string, Map<SlotKey, ProductMaterial>>;
  itemById: Map<string, MaterialItem>;
  stock: Map<string, ItemStock>;
  customerName: (partyId: string) => string | undefined;
  productCode: (productId: string) => string | undefined;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
  emptyMessage: string;
}

// Column widths (% of the table). Every column fits the page width; the
// table only scrolls sideways on screens narrower than its minimum width.
const BASE_COLS: { key: string; label: string; title?: string; width: number; align?: "right" }[] = [
  { key: "code", label: "Code", width: 3.8 },
  { key: "name", label: "Name", width: 6.8 },
  { key: "owner", label: "Owner", width: 4.4 },
  { key: "grade", label: "Grade", width: 3.6 },
  { key: "uom", label: "UOM", width: 4.6 },
  { key: "output", label: "Std Output", width: 4.2, align: "right" },
  { key: "planning", label: "Planning Item", width: 6.3 },
  { key: "cost", label: "Std Cost / Dz", title: "Standard cost per dozen (Rs.)", width: 4.6, align: "right" },
  { key: "sell", label: "Std Sell / Dz", title: "Standard selling price per dozen (Rs.)", width: 4.6, align: "right" },
  { key: "status", label: "Status", width: 5 },
];
const COLOR_WIDTH = 4.5;
const ACTIONS_WIDTH = 4.4;

const money = (v: number | null) => (v != null ? Number(v).toLocaleString() : null);

const Unset = ({ text }: { text: string }) => (
  <span className="text-[11px] font-medium text-amber-600">⚠ {text}</span>
);

export function ProductsTable({
  products,
  slots,
  byProduct,
  itemById,
  stock,
  customerName,
  productCode,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  emptyMessage,
}: Props) {
  const showMaterials = slots.length > 0;
  // Material columns share what is left after the fixed columns.
  const fixed =
    BASE_COLS.reduce((n, c) => n + c.width, 0) + ACTIONS_WIDTH + (showMaterials ? COLOR_WIDTH : 0);
  const slotWidth = showMaterials ? (100 - fixed) / slots.length : 0;
  const colCount = BASE_COLS.length + 1 + (showMaterials ? slots.length + 1 : 0);

  const th = "overflow-hidden px-1.5 py-2 text-left align-bottom text-[9.5px] font-semibold uppercase leading-[1.15] tracking-tight text-muted-foreground first:pl-2.5";
  const td = "px-1.5 py-2 align-middle first:pl-2.5";

  return (
    <div className="max-h-[calc(100vh-15rem)] min-h-[16rem] overflow-auto rounded-lg border bg-card">
      <table className={cn("w-full table-fixed border-collapse text-[12px] leading-snug", showMaterials ? "min-w-[1040px]" : "min-w-[720px]")}>
        <colgroup>
          {BASE_COLS.map((c) => (
            <col key={c.key} style={{ width: `${c.width}%` }} />
          ))}
          {showMaterials && <col style={{ width: `${COLOR_WIDTH}%` }} />}
          {showMaterials && slots.map((s) => <col key={s.key} style={{ width: `${slotWidth}%` }} />)}
          <col style={{ width: `${ACTIONS_WIDTH}%` }} />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
          {showMaterials && (
            <tr className="border-b border-border/70">
              <th colSpan={BASE_COLS.length} className="px-2.5 pt-2 pb-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Product
              </th>
              <th
                colSpan={slots.length + 1}
                className="border-l border-border/70 px-1.5 pt-2 pb-1 text-left text-[10px] font-semibold uppercase tracking-wider text-primary"
              >
                Raw materials · item and quantity per dozen
              </th>
              <th />
            </tr>
          )}
          <tr>
            {BASE_COLS.map((c) => (
              <th key={c.key} title={c.title} className={cn(th, c.align === "right" && "text-right")}>
                {c.label}
              </th>
            ))}
            {showMaterials && <th className={cn(th, "border-l border-border/70")}>Color</th>}
            {showMaterials &&
              slots.map((s) => (
                <th key={s.key} className={cn(th, "text-primary")}>
                  {s.label}
                </th>
              ))}
            <th className={cn(th, "text-center")}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="py-10 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            products.map((p) => {
              const mats = showMaterials ? effectiveMaterials(p, byProduct) : null;
              const owner =
                p.owner_type === "customer"
                  ? (p.customer_party_id && customerName(p.customer_party_id)) || "Customer"
                  : null;
              const planning = p.planning_items ? `${p.planning_items.code} — ${p.planning_items.name}` : null;
              const sell = Number(p.standard_selling_price) > 0 ? money(p.standard_selling_price) : null;
              return (
                <tr key={p.id} className="border-t border-border/60 transition-colors hover:bg-muted/40">
                  <td className={cn(td, "font-medium tabular-nums")}>{p.code}</td>
                  <td className={td}>
                    <span className="line-clamp-2 font-medium [overflow-wrap:break-word]" title={p.name}>
                      {p.name}
                    </span>
                  </td>
                  <td className={td}>
                    {owner ? (
                      <div className="min-w-0" title={owner}>
                        <span className="block truncate text-[11px] font-semibold">{owner}</span>
                        {p.base_product_id && productCode(p.base_product_id) && (
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            base: {productCode(p.base_product_id)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold">Own</span>
                    )}
                  </td>
                  <td className={cn(td, "truncate")} title={p.grades?.name ?? ""}>{p.grades?.name || "-"}</td>
                  <td className={cn(td, "truncate")} title={p.units_of_measure?.name ?? ""}>{p.units_of_measure?.name || "-"}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{p.standard_output_rate ?? "-"}</td>
                  <td className={td}>
                    {planning ? (
                      <span className="line-clamp-2 [overflow-wrap:break-word]" title={planning}>{planning}</span>
                    ) : (
                      <Unset text="not linked" />
                    )}
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    {money(p.standard_cost) ?? <Unset text="unset" />}
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    {sell ?? <Unset text="unset" />}
                  </td>
                  <td className={cn(td, "truncate")}>
                    <span className={cn("text-[11.5px] font-medium", p.is_active ? "text-green-600" : "text-red-500")}>
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {showMaterials && (
                    <td className={cn(td, "border-l border-border/70")} title={p.color ?? ""}>
                      {p.color ? (
                        <span className="line-clamp-2 [overflow-wrap:break-word]">{p.color}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {showMaterials &&
                    slots.map((s) => {
                      const row = mats?.get(s.key);
                      if (!row) {
                        return (
                          <td key={s.key} className={cn(td, "text-muted-foreground")}>
                            —
                          </td>
                        );
                      }
                      const it = itemById.get(row.item_id);
                      const level = stockLevel(stock.get(row.item_id));
                      const qty = fmtQty(Number(row.qty_per_dozen), it?.unit);
                      const waste = Number(row.wastage_pct) > 0 ? ` + ${Number(row.wastage_pct)}% wastage` : "";
                      return (
                        <td
                          key={s.key}
                          className={td}
                          title={`${it?.name ?? "Inactive item"} · ${qty} per dozen${waste}${row.inherited ? " · from base product" : ""} · ${STOCK_TEXT[level]}`}
                        >
                          <div className="min-w-0">
                            <span
                              className={cn(
                                "line-clamp-2 text-[11.5px] font-medium leading-tight [overflow-wrap:break-word]",
                                row.inherited && "italic text-foreground/75",
                              )}
                            >
                              {it?.name ?? "Inactive item"}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px] text-muted-foreground">
                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STOCK_DOT[level])} />
                              <span className="truncate">
                                {qty}
                              </span>
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  <td className={cn(td, "px-1")}>
                    <div className="flex items-center justify-center">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(p)}
                          aria-label={`Edit ${p.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(p)}
                          aria-label={`Delete ${p.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
