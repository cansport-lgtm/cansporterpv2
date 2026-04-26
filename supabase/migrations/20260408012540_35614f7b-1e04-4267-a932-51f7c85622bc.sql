
CREATE TABLE public.system_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  module TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read system_alerts" ON public.system_alerts FOR SELECT TO anon USING (true);
CREATE POLICY "Anyone can insert system_alerts" ON public.system_alerts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anyone can update system_alerts" ON public.system_alerts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete system_alerts" ON public.system_alerts FOR DELETE TO anon USING (true);
