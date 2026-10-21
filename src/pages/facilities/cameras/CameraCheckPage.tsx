import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Cctv, Loader2, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { ResultToggle } from "@/components/facilities/ResultToggle";
import { TimelineList } from "@/components/facilities/TimelineList";
import { photoUrl } from "@/lib/gatePass";
import { errorMessage, facilitiesCan, fmtDate, fmtDateTime } from "@/lib/facilities";
import {
  CAMERA_RESULTS, cameraResultLabel, cameraResultVariant, checkStatusMeta, discardCheck, loadCheck, loadCheckLines,
  loadCheckRecorders, reviewCheck, saveLine, saveRecorderLine, submitCheck, type CameraCheckLine, type CameraCheckRecorder,
} from "@/lib/facilitiesCameras";

const UNSET = "__unset__";

/** One day's camera check: the phone form while it is a draft, the record afterwards. */
export default function CameraCheckPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const { toast } = useToast();
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");

  const { data: check, isLoading } = useQuery({ queryKey: ["facilities-camera-check", id], enabled: Boolean(id), queryFn: () => loadCheck(id as string) });
  const { data: lines = [] } = useQuery({ queryKey: ["facilities-camera-check-lines", id], enabled: Boolean(id), queryFn: () => loadCheckLines(id as string) });
  const { data: recs = [] } = useQuery({ queryKey: ["facilities-camera-check-recorders", id], enabled: Boolean(id), queryFn: () => loadCheckRecorders(id as string) });
  const [remarks, setRemarks] = useState("");
  const [review, setReview] = useState("");
  useEffect(() => { if (check) setRemarks(check.remarks ?? ""); }, [check]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-camera-check", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-camera-check-lines", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-camera-check-recorders", id] });
    queryClient.invalidateQueries({ queryKey: ["facilities-camera-checks"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-events", "camera_check", id] });
  };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });

  const line = useMutation({
    mutationFn: (v: { lineId: string; result: string; remark: string; photo: string }) => saveLine(v.lineId, v.result, v.remark, v.photo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities-camera-check-lines", id] }),
    onError: fail("Not saved"),
  });
  const rec = useMutation({
    mutationFn: (v: { lineId: string; data: Record<string, unknown> }) => saveRecorderLine(v.lineId, v.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["facilities-camera-check-recorders", id] }),
    onError: fail("Not saved"),
  });
  const submit = useMutation({
    mutationFn: () => submitCheck(id as string, remarks),
    onSuccess: () => { toast({ title: "Camera check submitted" }); invalidate(); },
    onError: fail("Cannot submit"),
  });
  const doReview = useMutation({
    mutationFn: () => reviewCheck(id as string, review),
    onSuccess: () => { toast({ title: "Marked as reviewed" }); invalidate(); },
    onError: fail("Cannot review"),
  });
  const discard = useMutation({
    mutationFn: () => discardCheck(id as string),
    onSuccess: () => { toast({ title: "Draft discarded" }); queryClient.invalidateQueries({ queryKey: ["facilities-camera-checks"] }); navigate("/facilities/cameras/checks"); },
    onError: fail("Cannot discard"),
  });

  if (isLoading || !check) {
    return <ERPLayout><div className="p-6 text-muted-foreground">{isLoading ? "Loading…" : "Camera check not found."}</div></ERPLayout>;
  }

  const editable = check.status === "draft" && canOperate;
  const done = lines.filter((l) => l.result).length;
  const faults = lines.filter((l) => l.result && l.result !== "ok");
  const recMissing = recs.filter((r) => r.is_recording === null).length;
  const meta = checkStatusMeta(check.status);

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title={`${check.check_number} · ${fmtDate(check.check_date)}`} description="Security camera daily check" icon={Cctv}>
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <Button variant="outline" asChild><Link to="/facilities/cameras/checks"><ArrowLeft className="h-4 w-4 mr-1" /> All checks</Link></Button>
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,340px)] gap-4">
          <div className="space-y-4">
            {editable && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between text-sm"><span>{done} / {lines.length} cameras done</span><span className="text-muted-foreground">{faults.length} fault(s)</span></div>
                  <Progress value={lines.length ? (done / lines.length) * 100 : 0} />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Cameras</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {lines.map((l) => (
                  <CameraLine key={l.id} line={l} editable={editable} busy={line.isPending}
                    onSave={(result, remark, photo) => line.mutate({ lineId: l.id, result, remark, photo })} />
                ))}
                {lines.length === 0 && <p className="text-sm text-muted-foreground">No cameras on this check.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recorders</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {recs.map((r) => (
                  <RecorderLine key={r.id} line={r} editable={editable} onSave={(data) => rec.mutate({ lineId: r.id, data })} />
                ))}
                {recs.length === 0 && <p className="text-sm text-muted-foreground">No recorders set up.</p>}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {editable ? (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Submit</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div><Label htmlFor="cck-remarks">Remarks</Label><Textarea id="cck-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} /></div>
                  {(done < lines.length || recMissing > 0) && (
                    <p className="text-xs text-amber-700">
                      Still missing: {done < lines.length ? `${lines.length - done} camera result(s)` : ""}{done < lines.length && recMissing > 0 ? ", " : ""}{recMissing > 0 ? `${recMissing} recorder answer(s)` : ""}.
                    </p>
                  )}
                  <Button className="w-full" onClick={() => submit.mutate()} disabled={submit.isPending || done < lines.length || recMissing > 0}>
                    {submit.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit check
                  </Button>
                  {canManage && (
                    <Button variant="ghost" className="w-full text-destructive" onClick={() => discard.mutate()} disabled={discard.isPending}>
                      <Trash2 className="h-4 w-4 mr-1" /> Discard draft
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Cameras</span><span>{check.camera_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">OK</span><span>{check.ok_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Faults</span><span className={check.fault_count ? "text-amber-700 font-medium" : ""}>{check.fault_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recorder issues</span><span>{check.recorder_fault_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Submitted</span><span>{check.submitter?.full_name ?? "—"} · {fmtDateTime(check.submitted_at)}</span></div>
                  {check.remarks && <p className="pt-1">{check.remarks}</p>}
                  {check.status === "reviewed" && (
                    <div className="flex justify-between pt-1"><span className="text-muted-foreground">Reviewed</span><span>{check.reviewer?.full_name ?? "—"} · {fmtDateTime(check.reviewed_at)}</span></div>
                  )}
                  {check.review_remarks && <p>{check.review_remarks}</p>}
                  {check.status === "submitted" && canManage && (
                    <div className="pt-2 space-y-2">
                      <Textarea placeholder="Review remarks (optional)" value={review} onChange={(e) => setReview(e.target.value)} rows={2} />
                      <Button className="w-full" onClick={() => doReview.mutate()} disabled={doReview.isPending}>Mark as reviewed</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <TimelineList documentType="camera_check" documentId={id} />
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}

function CameraLine({ line, editable, busy, onSave }: {
  line: CameraCheckLine; editable: boolean; busy: boolean;
  onSave: (result: string, remark: string, photo: string) => void;
}) {
  const [remark, setRemark] = useState(line.remark ?? "");
  const [photo, setPhoto] = useState(line.photo_path ?? "");
  useEffect(() => { setRemark(line.remark ?? ""); setPhoto(line.photo_path ?? ""); }, [line.remark, line.photo_path]);
  const isFault = line.result && line.result !== "ok";
  const url = photoUrl(line.photo_path);
  return (
    <div className="py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium"><span className="font-mono text-xs mr-2">{line.camera?.code}</span>{line.camera?.name}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{line.camera?.recorder?.code ?? ""}{line.camera?.channel_no ? ` ch ${line.camera.channel_no}` : ""}</span>
      </div>
      {editable ? (
        <>
          <ResultToggle value={line.result} options={CAMERA_RESULTS} disabled={busy} onChange={(v) => onSave(v, remark, photo)} />
          {isFault && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start">
              <Input value={remark} placeholder="Remark" onChange={(e) => setRemark(e.target.value)} onBlur={() => onSave(line.result as string, remark, photo)} />
              <PhotoInput id={`cam-photo-${line.id}`} label="Photo" folder="facilities/cameras" value={photo}
                onChange={(p) => { setPhoto(p); onSave(line.result as string, remark, p); }} />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={cameraResultVariant(line.result)}>{cameraResultLabel(line.result)}</Badge>
          {line.remark && <span className="text-muted-foreground">{line.remark}</span>}
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">photo</a>}
          {line.ticket_id && <Link to={`/facilities/equipment/tickets/${line.ticket_id}`} className="text-primary underline text-xs">ticket</Link>}
        </div>
      )}
    </div>
  );
}

function RecorderLine({ line, editable, onSave }: { line: CameraCheckRecorder; editable: boolean; onSave: (data: Record<string, unknown>) => void }) {
  const [v, setV] = useState({
    is_recording: line.is_recording === null ? UNSET : String(line.is_recording),
    footage_days: line.footage_days?.toString() ?? "",
    hdd_status: line.hdd_status ?? UNSET,
    clock_ok: line.clock_ok === null ? UNSET : String(line.clock_ok),
    remark: line.remark ?? "",
  });
  const save = (next: typeof v) => {
    setV(next);
    onSave({
      is_recording: next.is_recording === UNSET ? null : next.is_recording === "true",
      footage_days: next.footage_days || null,
      hdd_status: next.hdd_status === UNSET ? null : next.hdd_status,
      clock_ok: next.clock_ok === UNSET ? null : next.clock_ok === "true",
      remark: next.remark,
    });
  };
  const r = line.recorder;
  const bad = line.is_recording === false || line.hdd_status === "warning" || line.hdd_status === "failed" || line.clock_ok === false;
  if (!editable) {
    return (
      <div className="py-3 text-sm flex flex-wrap items-center gap-2">
        <span className="font-medium"><span className="font-mono text-xs mr-2">{r?.code}</span>{r?.name}</span>
        <Badge variant={line.is_recording === false ? "destructive" : bad ? "warning" : "success"}>
          {line.is_recording === false ? "Not recording" : "Recording"}
        </Badge>
        <span className="text-muted-foreground">{line.footage_days ?? "—"} days · HDD {line.hdd_status ?? "—"} · clock {line.clock_ok === null ? "—" : line.clock_ok ? "ok" : "wrong"}</span>
        {line.remark && <span className="text-muted-foreground">· {line.remark}</span>}
      </div>
    );
  }
  return (
    <div className="py-3 space-y-2">
      <div className="font-medium"><span className="font-mono text-xs mr-2">{r?.code}</span>{r?.name} <span className="text-xs text-muted-foreground">({r?.channels} ch, expect {r?.expected_retention_days} d)</span></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-xs">Recording?</Label>
          <Select value={v.is_recording} onValueChange={(x) => save({ ...v, is_recording: x })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={UNSET}>—</SelectItem><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Footage days</Label><Input type="number" inputMode="numeric" value={v.footage_days} onChange={(e) => setV({ ...v, footage_days: e.target.value })} onBlur={() => save(v)} /></div>
        <div>
          <Label className="text-xs">HDD</Label>
          <Select value={v.hdd_status} onValueChange={(x) => save({ ...v, hdd_status: x })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={UNSET}>—</SelectItem><SelectItem value="ok">OK</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date / time correct?</Label>
          <Select value={v.clock_ok} onValueChange={(x) => save({ ...v, clock_ok: x })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={UNSET}>—</SelectItem><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <Input placeholder="Remark" value={v.remark} onChange={(e) => setV({ ...v, remark: e.target.value })} onBlur={() => save(v)} />
    </div>
  );
}
