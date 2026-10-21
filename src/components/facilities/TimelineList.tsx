import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime, loadEvents } from "@/lib/facilities";

/** The event log of one facilities document (facilities_events). */
export function TimelineList({ documentType, documentId }: { documentType: string; documentId: string | undefined }) {
  const { data: events = [] } = useQuery({
    queryKey: ["facilities-events", documentType, documentId],
    enabled: Boolean(documentId),
    queryFn: () => loadEvents(documentType, documentId as string),
  });
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="grid grid-cols-[auto_1fr] gap-x-3 border-b pb-2 last:border-0">
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">{fmtDateTime(e.created_at)}</span>
                <span>
                  <span className="font-medium">{e.actor?.full_name ?? "System"}</span>
                  {" · "}{e.message ?? e.event.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
