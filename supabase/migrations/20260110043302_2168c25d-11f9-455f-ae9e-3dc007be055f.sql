-- Add qa_manager role to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_manager';

-- Note: After adding the role, you'll need to assign it to users via user_roles table
-- and set up module_permissions for qa_manager users with full QA access