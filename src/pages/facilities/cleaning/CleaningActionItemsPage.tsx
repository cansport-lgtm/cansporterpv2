import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ListChecks, Loader2, Wrench } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { photoUrl } from "@/lib/gatePass";
import { errorMessage, facilitiesCan, fcDb, fmtDate, fmtDateTime, todayPk } from "@/lib/facilities";
import { ACTION_SELECT, closeAction, reassignAction, type CleaningAction } from "@/lib/facilitiesCleaning";

type Tab = "open" | "overdue" | "closed";
type UserRow = { id: string; full_name: string | null };
const NONE = "__none__";

export default function CleaningActionItemsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles, user } = useAuth();
  const canManage = facilitiesCan(roles, "manage");
  const canClean = facilitiesCan(roles, "cleaning");
  const [tab, setTab] = useState<Tab>("open");
  const today = todayPk();

  const [closing, setClosing] = useState<CleaningAction | null>(null);
  const [note, setNote] = useState("");
  const [afterPhoto, setAfterPhoto] = useState("");
  const [reassigning, setReassigning] = useState<CleaningAction | null>(null);
  const [assignee, setAssignee] = useState(NONE);
  const [dueDate, setDueDate] = useState("");

  const { data: items = [], isLoading } = useQuery<CleaningAction[]>({
    queryKey: ["facilities-cleaning-actions", tab],
    queryFn: async () => {
      let q = fcDb.from("facilities_cleaning_actions").select(ACTION_SELECT);
      if (tab === "closed") q = q.eq("status", "closed").order("closed_at", { ascending: false }).limit(300);
      else if (tab === "overdue") q = q.eq("status", "open").lt("due_date", today).order("due_date");
      else q = q.eq("status", "open").order("due_date");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["facilities-users-active"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await fcDb.from("app_users").select("id, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["facilities-cleaning-actions"] });
    queryClient.invalidateQueries({ queryKey: ["facilities-events"] });
  };

  const close = useMutation({
    mutationFn: () => closeAction(closing!.id, note, afterPhoto),
    onSuccess: () => { invalidate(); setClosing(null); toast({ title: "Action item closed" }); },
    onError: (e) => toast({ title: "Could not close", description: errorMessage(e), variant: "destructive" }),
  });
  const reassign = useMutation({
    mutationFn: () => reassignAction(reassigning!.id, assignee === NONE ? null : assignee, dueDate || null),
    onSuccess: () => { invalidate(); setReassigning(null); toast({ title: "Action item reassigned" }); },
    onError: (e) => toast({ title: "Could not reassign", description: errorMessage(e), variant: "destructive" }),
  });

  const openClose = (a: CleaningAction) => { setClosing(a); setNote(""); setAfterPhoto(""); };
  const openReassign = (a: CleaningAction) => { setReassigning(a); setAssignee(a.assigned_to ?? NONE); setDueDate(a.due_date); };
  const mayClose = (a: CleaningAction) => a.status === "open" && (canManage || (canClean && a.assigned_to === user?.id));

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader title="Cleaning Action Items" description="Points that failed an inspection; the supervisor closes each one with an after photo" icon={ListChecks}>
          <Button variant="outline" asChild><Link to="/facilities/cleaning">Inspections</Link></Button>
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Nothing here.</CardContent></Card>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => {
            const overdue = a.status === "open" && a.due_date < today;
            const before = photoUrl(a.line?.photo_path);
            const after = photoUrl(a.after_photo_path);
            return (
              <Card key={a.id} className={overdue ? "border-red-300" : undefined}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      <Link className="underline" to={`/facilities/cleaning/${a.inspection_id}`}>{a.inspection?.inspection_number}</Link> · {a.area?.name}
                    </div>
                    <Badge variant={a.status === "closed" ? "success" : overdue ? "destructive" : "warning"}>
                      {a.status === "closed" ? "Closed" : overdue ? "Overdue" : "Open"}
                    </Badge>
                  </div>
                  <div className="font-medium leading-snug">{a.text}</div>
                  <div className="text-sm text-muted-foreground">
                    {a.assignee?.full_name ? `Assigned to ${a.assignee.full_name}` : "Not assigned"} · due {fmtDate(a.due_date)}
                  </div>
                  {(before || after) && (
                    <div className="flex gap-2">
                      {before && <a href={before} target="_blank" rel="noreferrer" className="text-center text-[10px] text-muted-foreground"><img src={before} alt="Before" className="h-16 w-16 rounded object-cover border" />before</a>}
                      {after && <a href={after} target="_blank" rel="noreferrer" className="text-center text-[10px] text-muted-foreground"><img src={after} alt="After" className="h-16 w-16 rounded object-cover border" />after</a>}
                    </div>
                  )}
                  {a.status === "closed" && (
                    <div className="text-xs text-muted-foreground">Closed {fmtDateTime(a.closed_at)}{a.close_note ? ` · ${a.close_note}` : ""}</div>
                  )}
                  {a.status === "open" && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {mayClose(a) && <Button size="sm" onClick={() => openClose(a)}>Close with photo</Button>}
                      {canManage && <Button size="sm" variant="outline" onClick={() => openReassign(a)}>Reassign</Button>}
                      {facilitiesCan(roles, "operate") && (
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/facilities/equipment/tickets/new?source=action_item&id=${a.id}&title=${encodeURIComponent(a.text)}`)}>
                          <Wrench className="h-4 w-4 mr-1" /> Equipment ticket
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Dialog open={Boolean(closing)} onOpenChange={(o) => !o && setClosing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Close action item</DialogTitle></DialogHeader>
            <p className="text-sm">{closing?.text}</p>
            <PhotoInput id="action-after-photo" label="Take the after photo" folder="facilities/cleaning" value={afterPhoto} onChange={setAfterPhoto} />
            <div className="space-y-1">
              <Label htmlFor="action-note">Note</Label>
              <Textarea id="action-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClosing(null)}>Cancel</Button>
              <Button disabled={!afterPhoto || close.isPending} onClick={() => close.mutate()}>
                {close.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Close item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(reassigning)} onOpenChange={(o) => !o && setReassigning(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reassign action item</DialogTitle></DialogHeader>
            <p className="text-sm">{reassigning?.text}</p>
            <div className="space-y-1">
              <Label htmlFor="action-assignee">Assign to</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="action-assignee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="action-due">Due date</Label>
              <Input id="action-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReassigning(null)}>Cancel</Button>
              <Button disabled={reassign.isPending} onClick={() => reassign.mutate()}>
                {reassign.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
