// Form state and payload helpers for the gate pass form sections
// (returnable / job-work lines, scrap lines, manual backfill).

import { useQuery } from "@tanstack/react-query";
import { gpDb } from "@/lib/gatePass";

export type GoodsKind = "product" | "item" | "machine" | "fixed_asset" | "spare_part" | "other";
export type GoodsLine = {
  key: string;
  kind: GoodsKind;
  ref_id: string;
  description: string;
  uom: string;
  quantity: string;
  output_kind: "product" | "item" | "other";
  output_ref_id: string;
  output_description: string;
};

export const newGoodsLine = (kind: GoodsKind = "other"): GoodsLine => ({
  key: crypto.randomUUID(), kind, ref_id: "", description: "", uom: "", quantity: kind === "machine" || kind === "fixed_asset" ? "1" : "",
  output_kind: "other", output_ref_id: "", output_description: "",
});

export const goodsLinesPayload = (lines: GoodsLine[]) =>
  lines
    .filter((l) => l.ref_id || l.description.trim() || l.quantity)
    .map((l) => ({
      kind: l.kind,
      ref_id: l.kind === "other" ? null : l.ref_id || null,
      description: l.description,
      uom: l.uom || null,
      quantity: l.quantity,
      output_kind: l.output_kind,
      output_ref_id: l.output_kind === "other" ? null : l.output_ref_id || null,
      output_description: l.output_description,
    }));

export type ScrapLine = { key: string; scrap_category_id: string; quantity: string; rate: string };
export const newScrapLine = (): ScrapLine => ({ key: crypto.randomUUID(), scrap_category_id: "", quantity: "", rate: "" });

export type YardRow = { category_id: string; name: string; uom: string; is_active: boolean; opening: number; scrap_in: number; scrap_out: number; balance: number };

export function useScrapYard() {
  return useQuery<YardRow[]>({
    queryKey: ["scrap-yard-balance"],
    queryFn: async () => {
      const { data, error } = await gpDb.from("v_scrap_yard_balance").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export const scrapLinesPayload = (lines: ScrapLine[]) =>
  lines
    .filter((l) => l.scrap_category_id || l.quantity || l.rate)
    .map((l) => ({ scrap_category_id: l.scrap_category_id || null, quantity: l.quantity, rate: l.rate }));

export type BackfillState = {
  book_id: string;
  book_serial: string;
  paper_datetime: string; // datetime-local value, factory time
  photo_path: string;
  reason: string;
};
export const emptyBackfill = (): BackfillState => ({ book_id: "", book_serial: "", paper_datetime: "", photo_path: "", reason: "" });

/** datetime-local (Pakistan time, no zone) → ISO with +05:00. */
export const pkLocalToIso = (v: string) => (v ? `${v}:00+05:00` : "");

export const backfillPayload = (b: BackfillState) => ({
  book_id: b.book_id,
  book_serial: b.book_serial,
  paper_datetime: pkLocalToIso(b.paper_datetime),
  photo_path: b.photo_path,
  reason: b.reason,
});
