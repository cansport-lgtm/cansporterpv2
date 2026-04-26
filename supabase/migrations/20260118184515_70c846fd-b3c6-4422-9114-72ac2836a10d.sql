-- Add 'order_management' role to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'order_management';