-- Machine Monitor: worker assigned to each machine, shown on the
-- Hourly Production Live Overview machine cards.
ALTER TABLE public.machine_monitor_machines
  ADD COLUMN IF NOT EXISTS assigned_worker text;
