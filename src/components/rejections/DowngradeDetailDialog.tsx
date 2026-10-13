import type { ReactNode } from "react";
import { ArrowRight, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Downgrade,
  STATUS_CLASS,
  STATUS_LABEL,
  fmtDate,
  fmtStamp,
  printDowngradeForm,
  rs,
} from "@/lib/rwDowngrades";

export function DowngradeStatusBadge({ status }: { status: Downgrade["status"] }) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function GradeChange({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="rounded border bg-muted px-1.5 text-xs font-semibold">{from}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="rounded border bg-muted px-1.5 text-xs font-semibold">{to}</span>
    </span>
  );
}

function Section({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {n && (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {n}
          </span>
        )}
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="p-3 text-sm">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

/** Read-only view of a downgrade form, with print. `actions` adds role-specific buttons. */
export function DowngradeDetailDialog({
  downgrade: d,
  onOpenChange,
  actions,
}: {
  downgrade: Downgrade | null;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
}) {
  return (
    <Dialog open={!!d} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {d && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-display">Downgrade Form {d.downgrade_no}</span>
                <DowngradeStatusBadge status={d.status} />
              </DialogTitle>
              <p className="text-sm text-muted-foreground">Raised {fmtDate(d.request_date)}</p>
            </DialogHeader>

            <div className="space-y-3">
              <Section n={1} title="Basic details">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Name">{d.requester_name}</Field>
                  <Field label="Department">{d.department_name || "—"}</Field>
                  <Field label="Item Name">{d.item_name}</Field>
                  <Field label="Quantity">
                    {Number(d.quantity).toLocaleString()} {d.unit}
                  </Field>
                  <Field label="Original Grade → Proposed Downgrade">
                    <GradeChange from={d.original_grade_name} to={d.proposed_grade_name} />
                  </Field>
                </div>
              </Section>

              <Section n={2} title="Reason for downgrading">
                <div className="space-y-2">
                  <Field label="Issue"><span className="whitespace-pre-wrap">{d.issue}</span></Field>
                  <Field label="Why original grade cannot be used">
                    <span className="whitespace-pre-wrap">{d.why_original_unusable}</span>
                  </Field>
                  <Field label="Reason for converting">
                    <span className="whitespace-pre-wrap">{d.reason_for_converting}</span>
                  </Field>
                </div>
              </Section>

              <Section title="Downgrade costing">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Original grade rate">{rs(d.original_rate)} / {d.unit}</Field>
                  <Field label="Downgraded rate">{rs(d.downgraded_rate)} / {d.unit}</Field>
                  <Field label="Downgrade loss">
                    <span className="font-semibold text-destructive">{rs(d.cost_loss)}</span>
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  (Original rate − Downgraded rate) × Quantity. No stock impact; counted in R&amp;W Analytics once approved.
                </p>
              </Section>

              <Section n={3} title="Approval">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Status"><DowngradeStatusBadge status={d.status} /></Field>
                  <Field label="Approved / Rejected by">
                    {d.status === "approved" || d.status === "rejected" ? d.reviewed_by_name || "—" : "—"}
                  </Field>
                  <Field label="Date">
                    {d.status === "approved" || d.status === "rejected" ? fmtStamp(d.reviewed_at) : "—"}
                  </Field>
                  {d.review_notes && (
                    <div className="sm:col-span-3">
                      <Field label="Remarks"><span className="whitespace-pre-wrap">{d.review_notes}</span></Field>
                    </div>
                  )}
                </div>
              </Section>
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => printDowngradeForm(d)}>
                <Printer className="mr-2 h-4 w-4" /> Print / PDF
              </Button>
              <div className="flex flex-wrap gap-2">{actions}</div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
