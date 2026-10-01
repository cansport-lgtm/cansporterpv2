import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { addDays, format } from "date-fns";
import { Check, ChevronsUpDown, DoorOpen, Loader2, Send } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  errorMessage, hasAnyRole, invalidatePassQueries, passKeys, passKinds, ppDb, todayPk,
  type PassKind, type PassPerson, type PersonPassVariant,
} from "@/lib/personGatePass";

type Person = PassPerson & { id: string };

/** Apply for a worker or staff gate pass (half day / short leave). */
export function PersonGatePassFormPage({ variant }: { variant: PersonPassVariant }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canApply = hasAnyRole(roles, variant.applyRoles);
  const today = todayPk();
  const keys = passKeys(variant);
  const kinds = passKinds(variant);
  const idp = `${variant.prefix.toLowerCase()}-`;

  const [employeeId, setEmployeeId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<PassKind>("short_leave");
  const [passDate, setPassDate] = useState(today);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [leaveTime, setLeaveTime] = useState("");

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: [keys.picker],
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(variant.employeeTable)
        .select(`id, employee_code, full_name, photo_url, ${variant.personExtraSelect}, production_departments(name)`)
        .eq("is_active", true)
        .order("employee_code");
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });

  const { data: settings } = useQuery<{ default_expected_minutes: number } | null>({
    queryKey: [keys.settings],
    queryFn: async () => {
      const { data } = await ppDb.from(variant.settingsTable).select("default_expected_minutes, grace_minutes, day_end_time, auto_half_day_not_returned").maybeSingle();
      return data ?? null;
    },
  });

  // The person's live pass for that date, if any (the database refuses a second one).
  const { data: existing } = useQuery<{ pass_number: string; status: string } | null>({
    queryKey: [keys.existing, employeeId, passDate],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const { data } = await ppDb
        .from(variant.table)
        .select("pass_number, status")
        .eq("employee_id", employeeId)
        .eq("pass_date", passDate)
        .in("status", ["pending_approval", "approved", "out"])
        .maybeSingle();
      return data ?? null;
    },
  });

  const person = useMemo(() => people.find((w) => w.id === employeeId), [people, employeeId]);
  const sub = variant.personSubline(person);
  const defaultMinutes = settings?.default_expected_minutes ?? 30;

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await ppDb.rpc(`${variant.fnPrefix}_apply`, {
        p_employee_id: employeeId,
        p_kind: kind,
        p_reason: reason,
        p_expected_minutes: kind === "short_leave" ? Number(minutes || defaultMinutes) : null,
        p_leave_time: leaveTime || null,
        p_pass_date: passDate,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast({ title: "Sent for approval", description: `${variant.approverText.charAt(0).toUpperCase()}${variant.approverText.slice(1)} has been notified.` });
      invalidatePassQueries(queryClient, variant);
      navigate(`${variant.basePath}/${id}`);
    },
    onError: (e) => toast({ title: "Could not apply", description: errorMessage(e), variant: "destructive" }),
  });

  if (!canApply) {
    return (
      <ERPLayout>
        <div className="p-8 text-center text-muted-foreground">Only {variant.applyRolesText} can apply for a {variant.noun} gate pass.</div>
      </ERPLayout>
    );
  }

  const ready = Boolean(employeeId) && reason.trim().length > 0 && !existing &&
    (kind === "half_day" || Number(minutes || defaultMinutes) >= 5);

  return (
    <ERPLayout>
      <div className="w-full max-w-2xl space-y-4">
        <PageHeader title={variant.newTitle} description="Apply for a half day or a short leave. The approver decides; the guard scans the pass at the gate." icon={DoorOpen} iconColor={variant.iconColor} />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">{variant.label}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between h-12">
                  {person ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <EmployeeAvatar name={person.full_name} photoUrl={person.photo_url} className="h-7 w-7" />
                      <span className="truncate">{person.employee_code} · {person.full_name}</span>
                    </span>
                  ) : `Select a ${variant.noun} by code or name`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Type code or name…" />
                  <CommandList>
                    <CommandEmpty>No active {variant.noun} matches.</CommandEmpty>
                    <CommandGroup>
                      {people.map((w) => (
                        <CommandItem key={w.id} value={`${w.employee_code} ${w.full_name}`} onSelect={() => { setEmployeeId(w.id); setPickerOpen(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", employeeId === w.id ? "opacity-100" : "opacity-0")} />
                          <EmployeeAvatar name={w.full_name} photoUrl={w.photo_url} className="h-6 w-6 mr-2" />
                          <span>{w.employee_code} · {w.full_name}</span>
                          {w.production_departments?.name && <span className="ml-auto text-xs text-muted-foreground">{w.production_departments.name}</span>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {person && (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <EmployeeAvatar name={person.full_name} photoUrl={person.photo_url} className="h-14 w-14" />
                <div className="text-sm">
                  <div className="font-semibold">{person.full_name}</div>
                  <div className="text-muted-foreground">{person.employee_code}{person.production_departments?.name ? ` · ${person.production_departments.name}` : ""}{sub ? ` · ${sub}` : ""}</div>
                  {!person.photo_url && <div className="text-xs text-amber-700 mt-1">No photo on file — the guard will check by code and name only.</div>}
                </div>
              </div>
            )}
            {existing && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                This {variant.noun} already has pass <b>{existing.pass_number}</b> ({existing.status.replace("_", " ")}) for {format(new Date(passDate), "dd MMM")}. Cancel it first, or pick another date.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pass</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {kinds.map((k) => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={cn("text-left rounded-xl border-2 p-3 transition-colors", kind === k.value ? variant.accentSelected : "border-border hover:bg-muted/50")}>
                  <div className="font-semibold">{k.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.description}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`${idp}date`}>Date</Label>
                <Input id={`${idp}date`} type="date" value={passDate} min={today} max={format(addDays(new Date(), 7), "yyyy-MM-dd")} onChange={(e) => setPassDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor={`${idp}leave`}>Leaving at (optional)</Label>
                <Input id={`${idp}leave`} type="time" value={leaveTime} onChange={(e) => setLeaveTime(e.target.value)} />
              </div>
              {kind === "short_leave" && (
                <div>
                  <Label htmlFor={`${idp}minutes`}>Expected minutes outside</Label>
                  <Input id={`${idp}minutes`} type="number" inputMode="numeric" min={5} max={720} placeholder={String(defaultMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <Label htmlFor={`${idp}reason`}>Reason</Label>
              <Textarea id={`${idp}reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "half_day" ? "e.g. Doctor's appointment" : "e.g. Bank work for the office"} />
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              {kind === "half_day"
                ? variant.halfDayEffect
                : `The guard scans the ${variant.noun} Out and later In. If the ${variant.noun} is not back ${defaultMinutes === Number(minutes || defaultMinutes) ? "in time" : "within the expected minutes"} plus the grace period, you and the approver are told. Still out at day end → the day is marked Half day.`}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => navigate(variant.basePath)}>Cancel</Button>
              <Button disabled={!ready || submit.isPending} onClick={() => submit.mutate()} className={variant.accentButton}>
                {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Send for approval
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
