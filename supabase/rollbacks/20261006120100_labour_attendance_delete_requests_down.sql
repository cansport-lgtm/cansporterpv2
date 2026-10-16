-- Rollback for 20261006120100_labour_attendance_delete_requests.sql (and the
-- role in 20261006120000_labour_attendance_delete_roles.sql, which cannot be
-- removed: enum values stay; unassign the role from users instead).
--
-- Attendance entries already deleted through an approved request stay deleted
-- (the central audit_log still holds their before-snapshots).

DROP TRIGGER IF EXISTS labour_attendance_delete_on_entry_delete ON public.labour_productivity_targets;
DROP FUNCTION IF EXISTS public.labour_attendance_delete_on_entry_delete();

DROP FUNCTION IF EXISTS public.labour_attendance_delete_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_request(uuid, text);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_notify(public.labour_attendance_delete_requests, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_log_event(public.labour_attendance_delete_requests, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_label(public.labour_attendance_delete_requests);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_user_name(uuid);
DROP FUNCTION IF EXISTS public.labour_attendance_delete_can(text);

DROP TABLE IF EXISTS public.labour_attendance_delete_log;
DROP TABLE IF EXISTS public.labour_attendance_delete_requests;
DROP SEQUENCE IF EXISTS public.labour_attendance_delete_request_seq;

DELETE FROM public.notifications WHERE reference_type = 'labour_attendance_delete_request';
