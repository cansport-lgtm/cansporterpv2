
-- Machine Monitor: Machines master
CREATE TABLE public.machine_monitor_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  department text,
  location text,
  custom_statuses text[] NOT NULL DEFAULT '{Running,Stopped,Idle,Breakdown}',
  current_status text NOT NULL DEFAULT 'Stopped',
  current_status_since timestamptz NOT NULL DEFAULT now(),
  current_remarks text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_monitor_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to machine_monitor_machines" ON public.machine_monitor_machines FOR ALL TO anon USING (true) WITH CHECK (true);

-- Machine Monitor: Status change log
CREATE TABLE public.machine_monitor_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machine_monitor_machines(id) ON DELETE CASCADE,
  status text NOT NULL,
  remarks text,
  changed_by uuid REFERENCES public.app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_monitor_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to machine_monitor_status_log" ON public.machine_monitor_status_log FOR ALL TO anon USING (true) WITH CHECK (true);
