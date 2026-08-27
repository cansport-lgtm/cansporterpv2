-- Add three new labour productivity roles for granular access control
-- labour_productivity_approver: Can approve entries and edit requests
-- labour_productivity_poster: Can create and post entries
-- labour_productivity_viewer: Read-only access

INSERT INTO roles (id, name, description, created_at, updated_at) VALUES
  (gen_random_uuid(), 'labour_productivity_approver', 'Labour Productivity Approver - Review and approve labour productivity entries and edit requests', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (id, name, description, created_at, updated_at) VALUES
  (gen_random_uuid(), 'labour_productivity_poster', 'Labour Productivity Poster - Create and post labour productivity entries', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (id, name, description, created_at, updated_at) VALUES
  (gen_random_uuid(), 'labour_productivity_viewer', 'Labour Productivity Viewer - Read-only access to labour productivity data', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
