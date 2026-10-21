import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ClipboardCheck, Loader2, Trash2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { ResultToggle } from "@/components/facilities/ResultToggle";
import { TimelineList } from "@/components/facilities/TimelineList";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { photoUrl } from "@/lib/gatePass";
import { cn } from "@/lib/utils";
import { errorMessage, facilitiesCan, fcDb, fmtDate, fmtDateTime, todayPk } from "@/lib/facilities";
import {
  INSPECTION_DETAIL_SELECT, RESULT_OPTIONS, cancelDraft, inspectionStatusMeta, liveScore, loadAreas,
  saveLine, sortedLines, startInspection, submitInspection,
  type Area, type Inspection, type InspectionLine, type InspectionShift, type LineResult,
} from "@/lib/facilitiesCleaning";

/** New inspection: pick the area (and shift), then the checklist opens. */
function StartForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [areaId, setAreaId] = useState("");
  const [date, setDate] = useState(todayPk());
  const [shift, setShift] = useState<InspectionShift>("morning");
  const { data: areas = [] } = useQuery<Area[]>({ queryKey: ["facilities-areas", "active"], queryFn: () => loadAreas(true) });
  const area = areas.find((a) => a.id === areaId);

  const start = useMutation({
    mutationFn: () => startInspection(areaId, date, area?.frequency === "twice_daily" ? shift : "morning"),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["facilities-inspections"] });
      navigate(`/facilities/cleaning/${id}`, { replace: true });
    },
    onError: (e) => toast({ title: "Could not start", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <Card className="max-w-md">
      <CardContent className="p-4 space-y-4">
        <div className="space-y-1">
          <Label htmlFor="ins-area">Area</Label>
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger id="ins-area"><SelectValue placeholder="Choose the area" /></SelectTrigger>
            <SelectContent>
              {areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.location ? ` · ${a.location}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="ins-date">Date</Label>
            <Input id="ins-date" type="date" value={date} max={todayPk()} onChange={(e) => setDate(e.target.value)} />
          </div>
          {area?.frequency === "twice_daily" && (
            <div className="space-y-1">
              <Label htmlFor="ins-shift">Shift</Label>
              <Select value={shift} onValueChange={(v) => setShift(v as InspectionShift)}>
                <SelectTrigger id="ins-shift"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="evening">Evening</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <Button className="w-full" disabled={!areaId || start.isPending} onClick={() => start.mutate()}>
          {start.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Open checklist
        </Button>
      </CardContent>
    </Card>
  );
}

function LineCard({ line, editable, onSaved }: { line: InspectionLine; editable: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const [result, setResult] = useState<LineResult | null>(line.result);
  const [remark, setRemark] = useState(line.remark ?? "");
  const [photo, setPhoto] = useState(line.photo_path ?? "");
  useEffect(() => { setResult(line.result); setRemark(line.remark ?? ""); setPhoto(line.photo_path ?? ""); }, [line]);

  const save = useMutation({
    mutationFn: (next: { result: LineResult | null; remark: string; photo: string }) => saveLine(line.id, next.result, next.remark, next.photo),
    onSuccess: onSaved,
    onError: (e) => toast({ title: "Not saved", description: errorMessage(e), variant: "destructive" }),
  });
  const commit = (patch: Partial<{ result: LineResult | null; remark: string; photo: string }>) => {
    const next = { result, remark, photo, ...patch };
    setResult(next.result); setRemark(next.remark); setPhoto(next.photo);
    save.mutate(next);
  };
  const url = photoUrl(line.photo_path);
  const needsPhoto = result === "not_ok" && !photo;

  return (
    <div className={cn("border-b last:border-0 py-3 space-y-2", result === "not_ok" && "bg-red-50/40 dark:bg-red-950/20 -mx-4 px-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium leading-snug">{line.sort_order}. {line.text}</div>
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {editable ? (
        <>
          <ResultToggle value={result} options={RESULT_OPTIONS} onChange={(v) => commit({ result: v as LineResult })} />
          {(result === "not_ok" || remark) && (
            <Input placeholder="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} onBlur={() => remark !== (line.remark ?? "") && commit({ remark })} />
          )}
          {result === "not_ok" && (
            <div>
              <PhotoInput id={`photo-${line.id}`} label="Take photo of the problem" folder="facilities/cleaning" value={photo} onChange={(p) => commit({ photo: p })} />
              {needsPhoto && <p className="text-xs text-red-700 mt-1">A photo is needed for a point marked Not OK.</p>}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={line.result === "ok" ? "success" : line.result === "not_ok" ? "destructive" : "secondary"}>
            {RESULT_OPTIONS.find((o) => o.value === line.result)?.label ?? "—"}
          </Badge>
          {line.remark && <span className="text-muted-foreground">{line.remark}</span>}
          {url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="h-14 w-14 rounded object-cover border" /></a>}
        </div>
      )}
    </div>
  );
}

export default function CleaningInspectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles, user } = useAuth();
  const canOperate = facilitiesCan(roles, "operate");
  const canManage = facilitiesCan(roles, "manage");
  const [remarks, setRemarks] = useState("");

  const { data: insp, isLoading } = useQuery<Inspection | null>({
    queryKey: ["facilities-inspection", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_inspections").select(INSPECTION_DETAIL_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => { if (insp) setRemarks(insp.remarks ?? ""); }, [insp]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["facilities-inspection", id] });
  const lines = sortedLines(insp);
  const score = liveScore(lines);
  const editable = Boolean(insp && insp.status === "draft" && canOperate && (canManage || insp.inspector_id === user?.id));
  const missing = lines.filter((l) => !l.result).length;
  const noPhoto = lines.filter((l) => l.result === "not_ok" && !l.photo_path).length;

  const submit = useMutation({
    mutationFn: () => submitInspection(id as string, remarks),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["facilities-inspections"] });
      queryClient.invalidateQueries({ queryKey: ["facilities-cleaning-actions"] });
      queryClient.invalidateQueries({ queryKey: ["facilities-events"] });
      toast({ title: "Inspection submitted", description: score.bad > 0 ? `${score.bad} action item(s) sent to the supervisor.` : undefined });
    },
    onError: (e) => toast({ title: "Could not submit", description: errorMessage(e), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: () => cancelDraft(id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["facilities-inspections"] });
      toast({ title: "Draft discarded" });
      navigate("/facilities/cleaning", { replace: true });
    },
    onError: (e) => toast({ title: "Could not discard", description: errorMessage(e), variant: "destructive" }),
  });

  if (!id) {
    if (!canOperate) return <ERPLayout><div className="p-8 text-center text-muted-foreground">You do not have permission to do cleaning inspections.</div></ERPLayout>;
    return (
      <ERPLayout>
        <div className="w-full max-w-full overflow-x-hidden space-y-4">
          <PageHeader title="New cleaning inspection" description="Choose the area; the checklist opens on the next screen" icon={ClipboardCheck} />
          <StartForm />
        </div>
      </ERPLayout>
    );
  }

  if (isLoading) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Loading…</div></ERPLayout>;
  if (!insp) return <ERPLayout><div className="p-8 text-center text-muted-foreground">Inspection not found. <Link className="text-primary underline" to="/facilities/cleaning">Back</Link></div></ERPLayout>;

  const status = inspectionStatusMeta(insp.status);

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title={`${insp.inspection_number} · ${insp.area?.name ?? ""}`}
          description={`${fmtDate(insp.inspection_date)}${insp.area?.frequency === "twice_daily" ? ` · ${insp.shift}` : ""}${insp.area?.location ? ` · ${insp.area.location}` : ""}`}
          icon={ClipboardCheck}
        >
          <Badge variant={status.variant}>{status.label}</Badge>
        </PageHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Checklist</CardTitle>
              <div className="text-sm tabular-nums">
                Score <span className="font-semibold">{score.score != null ? `${score.score}%` : "—"}</span>
                <span className="text-muted-foreground"> · {score.ok} ok · {score.bad} not ok · {score.na} n/a</span>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0">
              {lines.map((l) => <LineCard key={l.id} line={l} editable={editable} onSaved={refresh} />)}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{editable ? "Finish" : "Details"}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Inspector</span><span>{insp.inspector?.full_name ?? "—"}</span></div>
                {insp.submitted_at && <div className="flex justify-between"><span className="text-muted-foreground">Submitted</span><span>{fmtDateTime(insp.submitted_at)}</span></div>}
                {editable ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="ins-remarks">Remarks</Label>
                      <Textarea id="ins-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                    </div>
                    {(missing > 0 || noPhoto > 0) && (
                      <ul className="text-xs text-amber-700 list-disc pl-4">
                        {missing > 0 && <li>{missing} point(s) without a result</li>}
                        {noPhoto > 0 && <li>{noPhoto} Not OK point(s) without a photo</li>}
                      </ul>
                    )}
                    <Button className="w-full" disabled={missing > 0 || noPhoto > 0 || submit.isPending} onClick={() => submit.mutate()}>
                      {submit.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit inspection
                    </Button>
                    <Button variant="ghost" className="w-full text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                      <Trash2 className="h-4 w-4 mr-1" /> Discard draft
                    </Button>
                  </>
                ) : (
                  insp.remarks && <p>{insp.remarks}</p>
                )}
                {insp.status === "submitted" && insp.not_ok_count > 0 && (
                  <Button variant="outline" className="w-full" asChild><Link to="/facilities/cleaning/actions">Open action items</Link></Button>
                )}
              </CardContent>
            </Card>
            <TimelineList documentType="inspection" documentId={id} />
          </div>
        </div>
      </div>
    </ERPLayout>
  );
}
