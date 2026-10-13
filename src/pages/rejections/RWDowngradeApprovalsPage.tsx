import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DowngradeDetailDialog,
  DowngradeStatusBadge,
  GradeChange,
} from "@/components/rejections/DowngradeDetailDialog";
import { type Downgrade, DOWNGRADES_KEY, dgDb, fmtDate, reviewDowngrade, rs } from "@/lib/rwDowngrades";

/** Super admin: approve or reject pending downgrade forms. */
export default function RWDowngradeApprovalsPage() {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<Downgrade | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [DOWNGRADES_KEY, "pending"],
    queryFn: async () => {
      const { data, error } = await dgDb
        .from("rw_downgrades")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Downgrade[];
    },
  });

  const review = useMutation({
    mutationFn: ({ d, approve }: { d: Downgrade; approve: boolean }) =>
      reviewDowngrade(d.id, approve, (notes[d.id] || "").trim()),
    onSuccess: (_, { d, approve }) => {
      toast.success(approve ? `${d.downgrade_no} approved` : `${d.downgrade_no} rejected`);
      qc.invalidateQueries({ queryKey: [DOWNGRADES_KEY] });
      setViewing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = (d: Downgrade, approve: boolean) => {
    if (!approve && !(notes[d.id] || "").trim()) {
      setErrors((x) => ({ ...x, [d.id]: "Add a remark to explain the rejection." }));
      return;
    }
    setErrors((x) => ({ ...x, [d.id]: "" }));
    review.mutate({ d, approve });
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full space-y-4 overflow-x-hidden">
        <PageHeader
          title="Downgrade Approvals"
          description="Approve or reject downgrade forms. A rejected form is closed; the requester raises a new one."
          icon={ShieldCheck}
          iconColor="bg-amber-500 text-white"
        />

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
        ) : !rows.length ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No forms waiting. New submissions appear here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((d) => (
              <Card key={d.id}>
                <CardContent className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-semibold">{d.downgrade_no}</span>
                      <DowngradeStatusBadge status={d.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Raised by {d.requester_name} · {d.department_name || "—"} · {fmtDate(d.request_date)}
                    </p>
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Item</dt><dd>{d.item_name}</dd>
                      <dt className="text-muted-foreground">Quantity</dt>
                      <dd>{Number(d.quantity).toLocaleString()} {d.unit}</dd>
                      <dt className="text-muted-foreground">Grade change</dt>
                      <dd><GradeChange from={d.original_grade_name} to={d.proposed_grade_name} /></dd>
                      <dt className="text-muted-foreground">Rates</dt>
                      <dd>{rs(d.original_rate)} → {rs(d.downgraded_rate)} per {d.unit}</dd>
                      <dt className="text-muted-foreground">Downgrade loss</dt>
                      <dd className="font-semibold text-destructive">{rs(d.cost_loss)}</dd>
                    </dl>
                  </div>
                  <div className="min-w-0 space-y-2 text-sm">
                    <Reason label="Issue" text={d.issue} />
                    <Reason label="Why original grade cannot be used" text={d.why_original_unusable} />
                    <Reason label="Reason for converting" text={d.reason_for_converting} />
                    <div className="space-y-1 pt-1">
                      <Label htmlFor={`rm-${d.id}`} className="text-xs">Remarks (required to reject)</Label>
                      <Textarea id={`rm-${d.id}`} rows={2} placeholder="Add a note for the requester"
                        value={notes[d.id] || ""} onChange={(e) => setNotes((x) => ({ ...x, [d.id]: e.target.value }))} />
                      {errors[d.id] && <p className="text-xs text-destructive">{errors[d.id]}</p>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(d)}>View full form</Button>
                      <Button size="sm" variant="outline" className="border-destructive text-destructive"
                        disabled={review.isPending} onClick={() => act(d, false)}>
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                      <Button size="sm" className="bg-green-600 text-white hover:bg-green-700"
                        disabled={review.isPending} onClick={() => act(d, true)}>
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <DowngradeDetailDialog downgrade={viewing} onOpenChange={(o) => !o && setViewing(null)} />
      </div>
    </ERPLayout>
  );
}

function Reason({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}
