-- Dispatch Operator role.
-- Can create domestic sales dispatches but is locked to the Dispatch page only
-- (no Orders, Invoices, pricing or any other page), so prices are never exposed.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dispatch_operator';
