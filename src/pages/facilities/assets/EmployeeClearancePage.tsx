import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ShieldAlert, UserCheck } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { employeeLabel, facilitiesCan, fmtDate, loadActiveEmployees } from "@/lib/facilities";
import { conditionMeta, loadCustody, loadEmployeeSims, type CustodyRow } from "@/lib/facilitiesAssets";
import { AssetMovementDialog } from "./AssetMovementDialog";

/**
 * Everything one employee still holds (office assets, SIMs) — the list HR
 * checks when someone leaves. Without an employee in the URL it is a picker.
 */
export default function EmployeeClearancePage() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const { roles } = useAuth();
  const canOperate = facilitiesCan(roles, "operate");
  const [returning, setReturning] = useState<CustodyRow | null>(null);

  const { data: employees = [] } = useQuery({ queryKey: ["facilities-employees"], queryFn: loadActiveEmployees });
  const { data: custody = [], isLoading } = useQuery({ queryKey: ["facilities-asset-custody"], queryFn: loadCustody });
  const { data: sims = [] } = useQuery({
    queryKey: ["facilities-employee-sims", employeeId],
    enabled: Boolean(employeeId),
    queryFn: () => loadEmployeeSims(employeeId as string),
  });

  const employee = employees.find((e) => e.id === employeeId);
  const assets = useMemo(() => custody.filter((r) => r.holder_employee_id === employeeId), [custody, employeeId]);
  const openSims = sims.filter((s) => s.status !== "closed");
  const clear = assets.length === 0 && openSims.length === 0;

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Employee Clearance"
          description="Office assets and SIM cards still with an employee. HR checks this before someone leaves."
          icon={UserCheck}
        >
          <Button variant="outline" asChild><Link to="/facilities/assets"><ArrowLeft className="h-4 w-4 mr-1" /> Custody</Link></Button>
        </PageHeader>

        <Card>
          <CardContent className="pt-4">
            <div className="grid gap-1.5 max-w-lg">
              <Label htmlFor="cl-emp">Employee</Label>
              <Select value={employeeId ?? ""} onValueChange={(v) => navigate(`/facilities/clearance/${v}`)}>
                <SelectTrigger id="cl-emp"><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{employeeLabel(e)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {employeeId && (
          <>
            <Card className={clear ? "border-emerald-300" : "border-amber-300"}>
              <CardContent className="pt-4 flex items-center gap-3">
                {clear ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : <ShieldAlert className="h-8 w-8 text-amber-600" />}
                <div>
                  <div className="font-semibold">
                    {employee ? employeeLabel(employee) : "Employee"} · {isLoading ? "checking…" : clear ? "Clear" : "Not clear"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {assets.length} office asset{assets.length === 1 ? "" : "s"} · {openSims.length} SIM{openSims.length === 1 ? "" : "s"} still with the employee
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Office assets</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Since</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Accessories</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No office asset with this employee.</TableCell></TableRow>
                    ) : assets.map((a) => {
                      const cond = conditionMeta(a.condition);
                      return (
                        <TableRow key={a.fixed_asset_id}>
                          <TableCell><span className="font-mono text-xs text-muted-foreground">{a.asset_code}</span> {a.name}</TableCell>
                          <TableCell className="tabular-nums">{fmtDate(a.since)}</TableCell>
                          <TableCell><Badge variant={cond.variant}>{cond.label}</Badge></TableCell>
                          <TableCell className="text-sm">{a.accessories ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {canOperate && <Button size="sm" variant="outline" onClick={() => setReturning(a)}>Return</Button>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">SIM cards</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[480px]">
                  <TableHeader>
                    <TableRow><TableHead>Number</TableHead><TableHead>Network</TableHead><TableHead>Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {openSims.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No SIM with this employee.</TableCell></TableRow>
                    ) : openSims.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono">{s.sim_number}</TableCell>
                        <TableCell>{s.network}</TableCell>
                        <TableCell><Badge variant="warning">{s.status.replace(/_/g, " ")}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {openSims.length > 0 && (
                  <p className="p-3 text-sm text-muted-foreground">Take SIMs back on <Link to="/facilities/sims" className="underline">SIM Register</Link>.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AssetMovementDialog asset={returning} type="return" open={Boolean(returning)} onOpenChange={(o) => { if (!o) setReturning(null); }} />
    </ERPLayout>
  );
}
