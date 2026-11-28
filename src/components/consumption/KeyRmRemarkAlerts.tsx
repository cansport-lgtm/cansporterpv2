import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Siren } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useKeyRmRemarks, type DueKind } from "@/hooks/useKeyRmRemarks";

const TEXT: Record<DueKind, string> = {
  reminder: "Remarks not yet submitted",
  overdue: "Remarks not submitted — overdue",
  approval: "Submitted remarks not approved — overdue",
};

// Super admins only: key raw material remark days past their submit/approve deadline.
export function KeyRmRemarkAlerts() {
  const r = useKeyRmRemarks(new Date());
  if (!r.isSuperAdmin || !r.settings?.enabled) return null;
  const rows = r.days.filter((d) => d.due_kind === "overdue" || d.due_kind === "approval");
  if (rows.length === 0) return null;
  return (
    <Card className="border-red-300 bg-red-50/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-red-700">
          <Siren className="h-4 w-4" /> Key raw material remarks overdue · {rows.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((d) => (
          <div key={d.report_date} className="flex flex-wrap items-center gap-x-3 border-b border-red-200 pb-1.5 text-sm last:border-0">
            <Link to={`/consumption/key-raw-materials?date=${d.report_date}`} className="font-semibold text-red-800 hover:underline">
              {format(parseISO(d.report_date), "dd MMM yyyy")}
            </Link>
            <span>{TEXT[d.due_kind!]}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
