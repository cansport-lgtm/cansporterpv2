import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { db, type MaterialCheck } from "@/lib/productMaterials";

// Production Planning: confirmed / approved orders whose raw-material check
// found a problem, so jobs aren't scheduled before the material is there.
export function OrdersWaitingOnMaterial() {
  const { data: checks = [] } = useQuery({
    queryKey: ["open-material-checks-with-issues"],
    queryFn: async () => {
      const { data, error } = await db
        .from("material_checks")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as MaterialCheck[]).filter(
        (c) => c.short_count + c.below_min_count + c.unknown_count + c.not_set_count + c.old_count > 0,
      );
    },
  });

  if (checks.length === 0) return null;
  const waiting = checks.filter((c) => c.short_count > 0).length;

  return (
    <div className="overflow-hidden rounded-xl border border-red-300 dark:border-red-900">
      <div className="flex flex-wrap items-center gap-3 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
        <span className="flex-1">
          <strong>
            {waiting} order{waiting === 1 ? "" : "s"} waiting on material
          </strong>
          {checks.length > waiting && ` · ${checks.length - waiting} more with stock warnings`}. Don't schedule them before
          the material is received.
        </span>
        <Link to="/purchase/material-shortages" className="font-semibold text-red-700 hover:underline dark:text-red-300">
          Shortage Summary
        </Link>
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2">Order</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Material</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-2 font-medium">
                  <Link to={`/purchase/material-shortages?check=${c.id}`} className="hover:underline">
                    {c.order_number ?? "—"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.order_label}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      c.short_count > 0
                        ? "rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white"
                        : "rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    }
                  >
                    {c.short_count > 0
                      ? "Waiting on material"
                      : c.unknown_count > 0
                        ? "Stock unknown"
                        : c.not_set_count > 0
                          ? "Set the materials"
                          : c.below_min_count > 0
                            ? "Can start · below min stock"
                            : "Old stock count"}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {[
                      c.short_count && `${c.short_count} short`,
                      c.unknown_count && `${c.unknown_count} unknown`,
                      c.below_min_count && `${c.below_min_count} below min`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
