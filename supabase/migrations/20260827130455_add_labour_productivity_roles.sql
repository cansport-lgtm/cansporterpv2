-- Add three new labour productivity roles as enum values for granular access control
-- labour_productivity_approver: Can approve entries and edit requests
-- labour_productivity_poster: Can create and post entries
-- labour_productivity_viewer: Read-only access

ALTER TYPE app_role ADD VALUE 'labour_productivity_approver';
ALTER TYPE app_role ADD VALUE 'labour_productivity_poster';
ALTER TYPE app_role ADD VALUE 'labour_productivity_viewer';
