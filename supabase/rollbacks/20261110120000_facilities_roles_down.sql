-- Rollback of 20261110120000_facilities_roles.sql.
-- PostgreSQL cannot drop a value from an enum. Remove the roles from users
-- instead; the enum values stay (harmless).
DELETE FROM public.user_roles
 WHERE role::text IN ('facilities_manager','facilities_officer','facilities_viewer',
                      'facilities_technician','cleaning_supervisor');
