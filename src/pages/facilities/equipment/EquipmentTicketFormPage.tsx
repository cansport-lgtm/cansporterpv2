import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";

import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoInput } from "@/components/gate-pass/PhotoInput";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, facilitiesCan, fcDb, rpc } from "@/lib/facilities";
import { type TicketCategory, type TicketPriority } from "@/lib/facilitiesEquipment";

type EquipmentOption = { id: string; code: string; name: string; location: string | null; type?: { name: string } | null };
const OTHER = "__other__";

/**
 * New equipment ticket. Served at /facilities/equipment/tickets/new (admin team)
 * and /report-fault (Self Service: any employee reports a fault).
 * Query params ?source=action_item&id=…&title=… prefill it from a cleaning action item.
 */
export default function EquipmentTicketFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const [params] = useSearchParams();
  const selfService = location.pathname === "/report-fault";
  const canOperate = facilitiesCan(roles, "operate");

  const [equipmentId, setEquipmentId] = useState<string>("");
  const [locationText, setLocationText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [category, setCategory] = useState<TicketCategory>("breakdown");
  const [photoPath, setPhotoPath] = useState("");

  useEffect(() => {
    const t = params.get("title");
    if (t) setTitle(t);
    const eq = params.get("equipment_id");
    if (eq) setEquipmentId(eq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: equipment = [] } = useQuery<EquipmentOption[]>({
    queryKey: ["facilities-equipment-options"],
    queryFn: async () => {
      const { data, error } = await fcDb.from("facilities_equipment")
        .select("id, code, name, location, type:facilities_equipment_types(name)")
        .eq("is_active", true).neq("status", "retired").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const source = params.get("source");
  const sourceRef = params.get("id");

  const create = useMutation({
    mutationFn: () => rpc<string>("facilities_ticket_create", {
      p_data: {
        title, description, priority, category,
        equipment_id: equipmentId && equipmentId !== OTHER ? equipmentId : null,
        location_text: equipmentId === OTHER || !equipmentId ? locationText : null,
        photo_path: photoPath || null,
        source: source === "action_item" ? "action_item" : "manual",
        source_ref: source === "action_item" ? sourceRef : null,
      },
    }),
    onSuccess: (id) => {
      toast({ title: "Reported", description: "The admin team has been told." });
      queryClient.invalidateQueries({ queryKey: ["facilities-tickets"] });
      navigate(`/facilities/equipment/tickets/${id}`);
    },
    onError: (e) => toast({ title: "Not sent", description: errorMessage(e), variant: "destructive" }),
  });

  const selected = equipment.find((e) => e.id === equipmentId);
  const canSend = title.trim().length > 0 && (Boolean(selected) || locationText.trim().length > 0);

  return (
    <ERPLayout>
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <PageHeader
          title={selfService ? "Report a Fault" : "New Equipment Ticket"}
          description={selfService ? "AC, printer, water dispenser, lights, lift… tell Admin what is wrong" : "Raise a ticket for office equipment or the building"}
          icon={AlertTriangle}
        />
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">What and where</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Equipment / location</Label>
              <Select value={equipmentId || OTHER} onValueChange={setEquipmentId}>
                <SelectTrigger id="tk-equipment"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {equipment.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.code} · {e.name}{e.location ? ` (${e.location})` : ""}</SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other (describe the location)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(!selected) && (
              <div className="space-y-1">
                <Label htmlFor="tk-location">Where is the fault?</Label>
                <Input id="tk-location" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Washroom F ground floor · exhaust fan" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="tk-title">What is wrong</Label>
              <Input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Water dripping from the indoor unit" maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tk-desc">Details (optional)</Label>
              <Textarea id="tk-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Since this morning; the floor below is wet" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>How urgent</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                  <SelectTrigger id="tk-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low · whenever</SelectItem>
                    <SelectItem value="medium">Normal</SelectItem>
                    <SelectItem value="high">Urgent · work stopped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {canOperate && (
                <div className="space-y-1">
                  <Label>Ticket type</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
                    <SelectTrigger id="tk-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakdown">Breakdown</SelectItem>
                      <SelectItem value="preventive">Preventive service</SelectItem>
                      <SelectItem value="cctv">CCTV</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Photo (optional)</Label>
              <PhotoInput id="tk-photo" label="Take a photo" folder="facilities/equipment" value={photoPath} onChange={setPhotoPath} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!canSend || create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Send to Admin
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
