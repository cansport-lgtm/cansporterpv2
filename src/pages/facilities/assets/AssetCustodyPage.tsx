import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Archive, ScanLine, UserCheck } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { QRScannerDialog } from "@/components/fixed-assets/QRScannerDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { facilitiesCan, fmtDate, fmtDateTime } from "@/lib/facilities";
import {
  ACK_META, MOVEMENT_LABEL, conditionMeta, loadCustody, loadMovements, type CustodyRow, type MovementType,
} from "@/lib/facilitiesAssets";
import { AssetMovementDialog } from "./AssetMovementDialog";

type Tab = "register" | "store" | "employee" | "movements";
const ALL = "__all__";

/**
 * Who holds which office asset. Assets come from Fixed Assets › Asset Register
 * (category Office Assets); this page only records custody.
 */
export default function AssetCustodyPage() {
  const { roles } = useAuth();
  const { toast } = useToast();
  const canOperate = facilitiesCan(roles, "operate");
  const [tab, setTab] = useState<Tab>("register");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [dialog, setDialog] = useState<{ asset: CustodyRow; type: MovementType } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({ queryKey: ["facilities-asset-custody"], queryFn: loadCustody });
  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ["facilities-asset-movements"], queryFn: () => loadMovements(), enabled: tab === "movements",
  });

  const departments = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { if (r.department_id && r.department_name) m.set(r.department_id, r.department_name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (department !== ALL && r.department_id !== department) return false;
      if (!q) return true;
      return [r.asset_code, r.name, r.holder, r.serial_number, r.location_description].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, search, department]);

  const inStore = filtered.filter((r) => !r.holder_employee_id);
  const held = filtered.filter((r) => r.holder_employee_id);

  const byEmployee = useMemo(() => {
    const m = new Map<string, { holder: string; department: string | null; assets: CustodyRow[] }>();
    held.forEach((r) => {
      const key = r.holder_employee_id as string;
      if (!m.has(key)) m.set(key, { holder: r.holder ?? "", department: r.holder_department, assets: [] });
      m.get(key)!.assets.push(r);
    });
    return [...m.entries()].sort((a, b) => a[1].holder.localeCompare(b[1].holder));
  }, [held]);

  const onScanned = (code: string) => {
    const asset = rows.find((r) => r.asset_code.toLowerCase() === code.trim().toLowerCase());
    setScanOpen(false);
    if (!asset) {
      toast({ title: "Not an office asset", description: `${code} is not in the custody register.`, variant: "destructive" });
      return;
    }
    setDialog({ asset, type: "verify" });
  };

  const actions = (r: CustodyRow) => canOperate ? (
    <div className="flex flex-wrap gap-1 justify-end">
      {r.holder_employee_id ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setDialog({ asset: r, type: "return" })}>Return</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ asset: r, type: "transfer" })}>Transfer</Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setDialog({ asset: r, type: "issue" })}>Issue</Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setDialog({ asset: r, type: "verify" })}>Verify</Button>
    </div>
  ) : null;

  const assetTable = (list: CustodyRow[], emptyText: string) => (
    <Table className="min-w-[900px]">
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Holder</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>Condition</TableHead>
          <TableHead>Last verified</TableHead>
          <TableHead className="text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
        ) : list.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{emptyText}</TableCell></TableRow>
        ) : list.map((r) => {
          const cond = conditionMeta(r.condition);
          return (
            <TableRow key={r.fixed_asset_id}>
              <TableCell>
                <div className="font-mono text-xs text-muted-foreground">{r.asset_code}</div>
                <div className="font-medium">{r.name}</div>
                {r.serial_number && <div className="text-xs text-muted-foreground">S/N {r.serial_number}</div>}
              </TableCell>
              <TableCell>
                {r.holder ? (
                  <Link to={`/facilities/clearance/${r.holder_employee_id}`} className="hover:underline">
                    {r.holder}
                    {r.holder_department && <div className="text-xs text-muted-foreground">{r.holder_department}</div>}
                  </Link>
                ) : <span className="text-muted-foreground">Admin store</span>}
              </TableCell>
              <TableCell className="text-sm">{r.location_description ?? r.department_name ?? "—"}</TableCell>
              <TableCell className="text-sm tabular-nums">{fmtDate(r.since)}</TableCell>
              <TableCell><Badge variant={cond.variant}>{cond.label}</Badge></TableCell>
              <TableCell className="text-sm tabular-nums">
                {r.last_verified_at ? fmtDate(r.last_verified_at) : <Badge variant="warning">not verified</Badge>}
              </TableCell>
              <TableCell className="text-right">{actions(r)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Asset Custody"
          description="Who holds which office asset. Assets come from Fixed Assets › Asset Register; values and disposal stay there."
          icon={Archive}
        >
          {canOperate && (
            <Button variant="outline" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4 mr-1" /> Scan QR to verify
            </Button>
          )}
        </PageHeader>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="register">Custody register ({rows.length})</TabsTrigger>
              <TabsTrigger value="store">In admin store ({rows.filter((r) => !r.holder_employee_id).length})</TabsTrigger>
              <TabsTrigger value="employee">By employee</TabsTrigger>
              <TabsTrigger value="movements">Movements</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-2 sm:ml-auto">
            <Input placeholder="Search asset, code, employee" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-56" />
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {tab === "register" && assetTable(filtered, "No office assets. Add them on Fixed Assets › Asset Register with category Office Assets.")}
            {tab === "store" && assetTable(inStore, "Nothing in the admin store.")}
            {tab === "employee" && (
              <div className="divide-y">
                {byEmployee.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No asset is with an employee.</p>
                ) : byEmployee.map(([employeeId, g]) => (
                  <div key={employeeId} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <UserCheck className="h-4 w-4 text-muted-foreground" />
                      <Link to={`/facilities/clearance/${employeeId}`} className="font-medium hover:underline">{g.holder}</Link>
                      {g.department && <span className="text-sm text-muted-foreground">· {g.department}</span>}
                      <Badge variant="secondary">{g.assets.length} asset{g.assets.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                      {g.assets.map((a) => {
                        const cond = conditionMeta(a.condition);
                        return (
                          <li key={a.fixed_asset_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
                            <span><span className="font-mono text-xs text-muted-foreground">{a.asset_code}</span> {a.name}</span>
                            <Badge variant={cond.variant}>{cond.label}</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {tab === "movements" && (
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Acknowledgement</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementsLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : movements.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No movements yet.</TableCell></TableRow>
                  ) : movements.map((m) => {
                    const cond = conditionMeta(m.condition);
                    const ack = ACK_META[m.ack_status];
                    const who = (e: { full_name: string; employee_code: string } | null | undefined) =>
                      e ? `${e.full_name} (${e.employee_code})` : "Admin store";
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.movement_number}</TableCell>
                        <TableCell className="tabular-nums text-sm">{fmtDate(m.movement_date)}</TableCell>
                        <TableCell><span className="font-mono text-xs text-muted-foreground">{m.asset?.asset_code}</span> {m.asset?.name}</TableCell>
                        <TableCell>{MOVEMENT_LABEL[m.movement_type]}</TableCell>
                        <TableCell className="text-sm">
                          {m.movement_type === "verify" ? who(m.to_employee) : `${who(m.from_employee)} → ${who(m.to_employee)}`}
                        </TableCell>
                        <TableCell><Badge variant={cond.variant}>{cond.label}</Badge></TableCell>
                        <TableCell>
                          {m.movement_type === "issue" || m.movement_type === "transfer" ? (
                            <Badge variant={ack.variant}>{ack.label}{m.acknowledged_at ? ` · ${fmtDateTime(m.acknowledged_at)}` : ""}</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{m.actor?.full_name ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AssetMovementDialog
        asset={dialog?.asset ?? null}
        type={dialog?.type ?? "issue"}
        open={Boolean(dialog)}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
      />
      <QRScannerDialog open={scanOpen} onOpenChange={setScanOpen} onAssetScanned={onScanned} scannedCodes={[]} />
    </ERPLayout>
  );
}
