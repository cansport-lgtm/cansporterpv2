import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cctv, HardDrive, Pencil, Plus } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb } from "@/lib/facilities";
import { loadCameras, loadRecorders, saveCamera, saveRecorder, type Camera, type Recorder } from "@/lib/facilitiesCameras";

const NONE = "__none__";
type CameraForm = { code: string; name: string; zone: string; recorder_id: string; channel_no: string; ip_address: string; fixed_asset_id: string; sort_order: string; is_active: boolean };
type RecorderForm = { code: string; name: string; channels: string; expected_retention_days: string; location: string; is_active: boolean };

const emptyCamera = (): CameraForm => ({ code: "", name: "", zone: "", recorder_id: NONE, channel_no: "", ip_address: "", fixed_asset_id: NONE, sort_order: "0", is_active: true });
const emptyRecorder = (): RecorderForm => ({ code: "", name: "", channels: "16", expected_retention_days: "30", location: "", is_active: true });

/** Masters: the cameras (what each one looks at, which recorder channel) and the NVR / DVR recorders. */
export default function CamerasPage() {
  const { roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = facilitiesCan(roles, "manage");

  const { data: cameras = [], isLoading } = useQuery({ queryKey: ["facilities-cameras"], queryFn: () => loadCameras(false) });
  const { data: recorders = [] } = useQuery({ queryKey: ["facilities-recorders"], queryFn: loadRecorders });
  const { data: officeAssets = [] } = useQuery<{ id: string; asset_code: string; name: string }[]>({
    queryKey: ["facilities-office-assets-for-cameras"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await fcDb.from("fixed_assets").select("id, asset_code, name").eq("category", "office_assets").neq("status", "disposed").order("asset_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [camOpen, setCamOpen] = useState(false);
  const [camId, setCamId] = useState<string | null>(null);
  const [cam, setCam] = useState<CameraForm>(emptyCamera());
  const [recOpen, setRecOpen] = useState(false);
  const [recId, setRecId] = useState<string | null>(null);
  const [rec, setRec] = useState<RecorderForm>(emptyRecorder());

  const openCamera = (c?: Camera) => {
    setCamId(c?.id ?? null);
    setCam(c ? {
      code: c.code, name: c.name, zone: c.zone ?? "", recorder_id: c.recorder_id ?? NONE, channel_no: c.channel_no?.toString() ?? "",
      ip_address: c.ip_address ?? "", fixed_asset_id: c.fixed_asset_id ?? NONE, sort_order: String(c.sort_order ?? 0), is_active: c.is_active,
    } : { ...emptyCamera(), sort_order: String(cameras.length + 1) });
    setCamOpen(true);
  };
  const openRecorder = (r?: Recorder) => {
    setRecId(r?.id ?? null);
    setRec(r ? { code: r.code, name: r.name, channels: String(r.channels), expected_retention_days: String(r.expected_retention_days), location: r.location ?? "", is_active: r.is_active } : emptyRecorder());
    setRecOpen(true);
  };

  const camSave = useMutation({
    mutationFn: () => saveCamera(camId, {
      ...cam,
      recorder_id: cam.recorder_id === NONE ? null : cam.recorder_id,
      fixed_asset_id: cam.fixed_asset_id === NONE ? null : cam.fixed_asset_id,
      channel_no: cam.channel_no || null,
    }),
    onSuccess: () => { toast({ title: camId ? "Camera updated" : "Camera added" }); setCamOpen(false); queryClient.invalidateQueries({ queryKey: ["facilities-cameras"] }); },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });
  const recSave = useMutation({
    mutationFn: () => saveRecorder(recId, rec),
    onSuccess: () => { toast({ title: recId ? "Recorder updated" : "Recorder added" }); setRecOpen(false); queryClient.invalidateQueries({ queryKey: ["facilities-recorders"] }); queryClient.invalidateQueries({ queryKey: ["facilities-cameras"] }); },
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Cameras & Recorders" description="Every active camera appears on the daily check" icon={Cctv}>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => openRecorder()}><HardDrive className="h-4 w-4 mr-1" /> Recorder</Button>
              <Button onClick={() => openCamera()}><Plus className="h-4 w-4 mr-1" /> Camera</Button>
            </div>
          )}
        </PageHeader>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cameras ({cameras.filter((c) => c.is_active).length} active)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Zone</TableHead><TableHead>Recorder · ch</TableHead><TableHead>IP</TableHead><TableHead>Status</TableHead>{canManage && <TableHead />}</TableRow></TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={8} className="text-muted-foreground">Loading…</TableCell></TableRow>
                : cameras.length === 0 ? <TableRow><TableCell colSpan={8} className="text-muted-foreground">No cameras yet. Add every camera that the daily check should cover.</TableCell></TableRow>
                : cameras.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="tabular-nums">{c.sort_order}</TableCell>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.zone ?? "—"}</TableCell>
                    <TableCell>{c.recorder?.code ?? "—"}{c.channel_no ? ` · ch ${c.channel_no}` : ""}</TableCell>
                    <TableCell className="font-mono text-xs">{c.ip_address ?? "—"}</TableCell>
                    <TableCell><Badge variant={c.is_active ? "success" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    {canManage && <TableCell><Button size="sm" variant="ghost" onClick={() => openCamera(c)}><Pencil className="h-4 w-4" /></Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recorders (NVR / DVR)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Channels</TableHead><TableHead className="text-right">Retention (days)</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead>{canManage && <TableHead />}</TableRow></TableHeader>
              <TableBody>
                {recorders.length === 0 ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">No recorders yet.</TableCell></TableRow>
                : recorders.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.channels}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.expected_retention_days}</TableCell>
                    <TableCell>{r.location ?? "—"}</TableCell>
                    <TableCell><Badge variant={r.is_active ? "success" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    {canManage && <TableCell><Button size="sm" variant="ghost" onClick={() => openRecorder(r)}><Pencil className="h-4 w-4" /></Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={camOpen} onOpenChange={setCamOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{camId ? "Edit camera" : "New camera"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label htmlFor="cam-code">Code</Label><Input id="cam-code" value={cam.code} onChange={(e) => setCam({ ...cam, code: e.target.value })} placeholder="CAM-01" /></div>
            <div><Label htmlFor="cam-order">Order on the check</Label><Input id="cam-order" type="number" value={cam.sort_order} onChange={(e) => setCam({ ...cam, sort_order: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="cam-name">Name (what it looks at)</Label><Input id="cam-name" value={cam.name} onChange={(e) => setCam({ ...cam, name: e.target.value })} placeholder="Main gate" /></div>
            <div><Label htmlFor="cam-zone">Zone</Label><Input id="cam-zone" value={cam.zone} onChange={(e) => setCam({ ...cam, zone: e.target.value })} placeholder="Gate / Store / Floor A / Office" /></div>
            <div><Label htmlFor="cam-ip">IP address</Label><Input id="cam-ip" value={cam.ip_address} onChange={(e) => setCam({ ...cam, ip_address: e.target.value })} /></div>
            <div>
              <Label>Recorder</Label>
              <Select value={cam.recorder_id} onValueChange={(v) => setCam({ ...cam, recorder_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>—</SelectItem>{recorders.map((r) => <SelectItem key={r.id} value={r.id}>{r.code} · {r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="cam-ch">Channel no.</Label><Input id="cam-ch" type="number" value={cam.channel_no} onChange={(e) => setCam({ ...cam, channel_no: e.target.value })} /></div>
            <div className="sm:col-span-2">
              <Label>Fixed asset (optional)</Label>
              <Select value={cam.fixed_asset_id} onValueChange={(v) => setCam({ ...cam, fixed_asset_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>—</SelectItem>{officeAssets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_code} · {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch id="cam-active" checked={cam.is_active} onCheckedChange={(v) => setCam({ ...cam, is_active: v })} /><Label htmlFor="cam-active">Active (on the daily check)</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCamOpen(false)}>Cancel</Button>
            <Button onClick={() => camSave.mutate()} disabled={camSave.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{recId ? "Edit recorder" : "New recorder"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label htmlFor="rec-code">Code</Label><Input id="rec-code" value={rec.code} onChange={(e) => setRec({ ...rec, code: e.target.value })} placeholder="NVR-1" /></div>
            <div><Label htmlFor="rec-name">Name</Label><Input id="rec-name" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} placeholder="Gate NVR 16 ch" /></div>
            <div><Label htmlFor="rec-ch">Channels</Label><Input id="rec-ch" type="number" value={rec.channels} onChange={(e) => setRec({ ...rec, channels: e.target.value })} /></div>
            <div><Label htmlFor="rec-ret">Expected footage (days)</Label><Input id="rec-ret" type="number" value={rec.expected_retention_days} onChange={(e) => setRec({ ...rec, expected_retention_days: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="rec-loc">Location</Label><Input id="rec-loc" value={rec.location} onChange={(e) => setRec({ ...rec, location: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch id="rec-active" checked={rec.is_active} onCheckedChange={(v) => setRec({ ...rec, is_active: v })} /><Label htmlFor="rec-active">Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecOpen(false)}>Cancel</Button>
            <Button onClick={() => recSave.mutate()} disabled={recSave.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
