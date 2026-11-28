import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Siren } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useRwReportOverview, type DueKind } from "@/hooks/useRwDailyReport";

const TEXT: Record<DueKind, string> = {
  reminder: "Report due, not yet submitted",
  overdue: "Report not submitted, overdue",
  approval: "Submitted report not approved, overdue",
};

// Dashboard card. Super admins see every overdue day; the rejections manager sees days they still have to submit.
export function RwReportAlerts() {
  const { roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const isManager = roles.some((r) => r.role === "rejections_manager");
  const { settings, days } = useRwReportOverview();
  if ((!isSuperAdmin && !isManager) || !settings.data?.enabled) return null;
  const rows = (days.data ?? []).filter((d) =>
    isSuperAdmin
      ? d.due_kind === "overdue" || d.due_kind === "approval"
      : d.due_kind === "reminder" || d.due_kind === "overdue",
  );
  if (rows.length === 0) return null;
  return (
    <Card className="border-red-300 bg-red-50/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-red-700">
          <Siren className="h-4 w-4" /> Rejections &amp; Wastages daily report · {rows.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((d) => (
          <div key={d.report_date} className="flex flex-wrap items-center gap-x-3 border-b border-red-200 pb-1.5 text-sm last:border-0">
            <Link to={`/rejections/daily-report?date=${d.report_date}`} className="font-semibold text-red-800 hover:underline">
              {format(parseISO(d.report_date), "dd MMM yyyy")}
            </Link>
            <span>{TEXT[d.due_kind!]}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
