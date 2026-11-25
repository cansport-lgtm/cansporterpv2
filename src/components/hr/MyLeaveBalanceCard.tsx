import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-in user's leave balance, always recomputed from the database:
 *  - allocation: the admin-set value on the balance record if present, otherwise 1 leave per
 *    month elapsed (same rule as HR > Leave Requests);
 *  - used: the sum of APPROVED leave requests starting in the year (the same source the HR
 *    "Recalculate" action uses), so a stale stored counter can never show a wrong balance.
 * Refetches on open, on window focus, every 30 s and via the Refresh button.
 */
export function MyLeaveBalanceCard() {
  const { user } = useAuth();
  const year = new Date().getFullYear();

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["my-leave-balance", user?.id, year],
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: emp, error: empErr } = await supabase
        .from("employees")
        .select("id, employee_code, leave_quota_type")
        .eq("app_user_id", user!.id)
        .eq("is_active", true)
        .maybeSingle();
      if (empErr) throw empErr;
      if (!emp) return null;

      const quotaType: "full_day" | "half_day" =
        (emp as any).leave_quota_type === "full_day" ? "full_day" : "half_day";

      const [{ data: bal, error: balErr }, { data: reqs, error: reqErr }] = await Promise.all([
        supabase
          .from("employee_leave_balances" as any)
          .select("total_allocated, half_day_allocated")
          .eq("employee_id", emp.id)
          .eq("year", year)
          .maybeSingle(),
        supabase
          .from("leave_requests")
          .select("total_days, status, start_date")
          .eq("employee_id", emp.id)
          .in("status", ["approved", "pending"])
          .gte("start_date", `${year}-01-01`)
          .lte("start_date", `${year}-12-31`),
      ]);
      if (balErr) throw balErr;
      if (reqErr) throw reqErr;

      const monthsElapsed = new Date().getMonth() + 1;
      const dbAlloc = Number(
        (quotaType === "full_day" ? (bal as any)?.total_allocated : (bal as any)?.half_day_allocated) ?? 0,
      );
      const allocated = dbAlloc > 0 ? dbAlloc : monthsElapsed;
      const sum = (status: string) =>
        (reqs || []).filter((r) => r.status === status).reduce((t, r) => t + Number(r.total_days), 0);
      const used = sum("approved");
      const pending = sum("pending");

      return {
        code: (emp as any).employee_code as string,
        quotaType,
        allocated,
        used,
        pending,
        remaining: allocated - used,
      };
    },
  });

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Leave balance — {year}</CardTitle>
          <CardDescription>
            Live from approved leave requests
            {dataUpdatedAt ? ` · updated ${format(new Date(dataUpdatedAt), "hh:mm:ss a")}` : ""}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load your leave balance. Press Refresh to retry.</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            Your login is not linked to an employee record, so there is no leave balance to show. Ask HR to link it.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Employee {data.code}</span>
              <Badge variant="secondary">{data.quotaType === "full_day" ? "Full-day quota" : "Half-day quota"}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Allocated", value: data.allocated },
                { label: "Used", value: data.used },
                { label: "Pending approval", value: data.pending },
                { label: "Remaining", value: data.remaining, strong: true },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3 text-center">
                  <div className={`text-2xl font-semibold ${s.strong && data.remaining < 0 ? "text-destructive" : ""}`}>
                    {fmt(s.value)}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
