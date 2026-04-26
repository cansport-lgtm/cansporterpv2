import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

interface AggregatedEntry {
  account_id: string;
  account: {
    id: string;
    code: string;
    name: string;
    account_type: string;
    sub_category: string | null;
    is_cash_account: boolean | null;
  };
  debit_amount: number;
  credit_amount: number;
}

/**
 * Fetches trial balance entries AND journal entry lines for a period,
 * then merges them into a single aggregated list per account.
 */
export function useFinancePeriodData(periodId: string) {
  const { data: tbEntries } = useQuery({
    queryKey: ["finance-tb-entries-report", periodId],
    queryFn: async () => {
      if (!periodId) return [];
      const { data, error } = await supabase
        .from("finance_trial_balance_entries")
        .select("*, account:finance_chart_of_accounts(*)")
        .eq("period_id", periodId);
      if (error) throw error;
      return data;
    },
    enabled: !!periodId,
  });

  const { data: jeLines } = useQuery({
    queryKey: ["finance-je-lines-report", periodId],
    queryFn: async () => {
      if (!periodId) return [];
      // Get all journal entries for this period, then their lines
      const { data: entries, error: jeError } = await supabase
        .from("finance_journal_entries")
        .select("id")
        .eq("period_id", periodId)
        .eq("status", "posted");
      if (jeError) throw jeError;
      if (!entries?.length) return [];

      const jeIds = entries.map((e) => e.id);
      const { data: lines, error: lineError } = await supabase
        .from("finance_journal_entry_lines")
        .select("*, account:finance_chart_of_accounts(*)")
        .in("journal_entry_id", jeIds);
      if (lineError) throw lineError;
      return lines;
    },
    enabled: !!periodId,
  });

  const mergedEntries: AggregatedEntry[] | null = useMemo(() => {
    if (!periodId) return null;
    // Wait for both queries to finish (they may return empty arrays)
    if (tbEntries === undefined && jeLines === undefined) return null;

    const map = new Map<string, AggregatedEntry>();

    const addToMap = (accountId: string, account: any, debit: number, credit: number) => {
      const existing = map.get(accountId);
      if (existing) {
        existing.debit_amount += debit;
        existing.credit_amount += credit;
      } else {
        map.set(accountId, {
          account_id: accountId,
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.account_type,
            sub_category: account.sub_category,
            is_cash_account: account.is_cash_account,
          },
          debit_amount: debit,
          credit_amount: credit,
        });
      }
    };

    // Add trial balance entries
    (tbEntries || []).forEach((e: any) => {
      if (e.account) {
        addToMap(e.account_id, e.account, Number(e.debit_amount || 0), Number(e.credit_amount || 0));
      }
    });

    // Add journal entry lines
    (jeLines || []).forEach((l: any) => {
      if (l.account) {
        addToMap(l.account_id, l.account, Number(l.debit_amount || 0), Number(l.credit_amount || 0));
      }
    });

    return Array.from(map.values());
  }, [periodId, tbEntries, jeLines]);

  return mergedEntries;
}
