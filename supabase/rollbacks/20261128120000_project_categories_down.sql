-- Rollback for 20261128120000_project_categories.sql
DROP INDEX IF EXISTS public.idx_projects_category_id;
ALTER TABLE public.projects DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS public.project_categories;
