import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_LANG, isLang, type Lang } from "@/lib/rwReportText";

const BOTH_KEY = "rw-report-show-english";

/** The user's report language (saved on their login) and the "also show English" switch (this device). */
export function useRwReportLanguage() {
  const { user } = useAuth();
  const saved = user?.ui_language;
  const [lang, setLangState] = useState<Lang>(isLang(saved) ? saved : DEFAULT_LANG);
  useEffect(() => { if (isLang(saved)) setLangState(saved); }, [saved]);

  const [both, setBothState] = useState(() => {
    try { return localStorage.getItem(BOTH_KEY) === "1"; } catch { return false; }
  });

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    if (!user) return;
    // ui_language is not in the generated Supabase types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("app_users").update({ ui_language: l }).eq("id", user.id);
  }, [user]);

  const setBoth = useCallback((v: boolean) => {
    setBothState(v);
    try { localStorage.setItem(BOTH_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  }, []);

  return { lang, setLang, both: both && lang !== "en", setBoth };
}
