import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export const CLOSING_DATE_QUERY_KEY = ["acc-period-close"];

/** Closing date (yyyy-MM-dd) or null when nothing is closed. */
export async function fetchClosingDate(): Promise<string | null> {
  const { data } = await sb.from("accounting_period_close").select("closed_through_date").eq("id", 1).maybeSingle();
  return data?.closed_through_date ?? null;
}

/** First date on which posting is allowed (day after closing), or undefined. */
export function minPostingDate(closedThrough?: string | null): string | undefined {
  if (!closedThrough) return undefined;
  return format(addDays(new Date(`${closedThrough}T00:00:00`), 1), "yyyy-MM-dd");
}

export function useClosingDate() {
  const { data } = useQuery({
    queryKey: CLOSING_DATE_QUERY_KEY,
    queryFn: async () => {
      const { data } = await sb.from("accounting_period_close").select("*").eq("id", 1).maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });
  const closedThrough: string | null = data?.closed_through_date ?? null;
  return { closedThrough, minDate: minPostingDate(closedThrough), state: data };
}

/** Turn a raw DB error into friendly text for the period lock. */
export function friendlyPostingError(message?: string | null): string {
  if (!message) return "Unknown error";
  const i = message.indexOf("PERIOD_CLOSED:");
  if (i === -1) return message;
  return message.slice(i + "PERIOD_CLOSED:".length).trim().replace(/^./, c => c.toUpperCase()) +
    " Ask a Super Admin if the period needs to be reopened.";
}
