
-- Add online_sales module permission for all users who have at least one module permission
INSERT INTO module_permissions (user_id, module_name, can_view, can_create, can_edit, can_delete, can_approve)
SELECT DISTINCT mp.user_id, 'online_sales', true, true, true, true, true
FROM module_permissions mp
WHERE NOT EXISTS (
  SELECT 1 FROM module_permissions mp2 
  WHERE mp2.user_id = mp.user_id AND mp2.module_name = 'online_sales'
);
